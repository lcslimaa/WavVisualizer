/**
 * Spotify OAuth via Authorization Code + PKCE — no client secret, so this
 * runs entirely client-side (this app has no backend). See
 * docs/superpowers/specs/2026-08-14-spotify-integration-design.md for the
 * full data-flow this implements.
 */

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = 'http://127.0.0.1:5173/';
const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state playlist-read-private';

const TOKENS_STORAGE_KEY = 'spotify_tokens';
const VERIFIER_STORAGE_KEY = 'spotify_pkce_verifier';
const STATE_STORAGE_KEY = 'spotify_oauth_state';
const PENDING_URL_STORAGE_KEY = 'spotify_pending_url';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readStoredTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKENS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function writeStoredTokens(tokens: StoredTokens): void {
  localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
}

/** Clears any stored session — call after a refresh fails (revoked/expired). */
export function logout(): void {
  localStorage.removeItem(TOKENS_STORAGE_KEY);
}

export function isLoggedIn(): boolean {
  return readStoredTokens() !== null;
}

/**
 * Starts the login flow: stashes `pendingUrl` (returned by
 * handleRedirectCallback() after the user comes back) and full-page-
 * redirects to Spotify's consent screen.
 */
export async function login(pendingUrl: string): Promise<void> {
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(16);

  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  sessionStorage.setItem(STATE_STORAGE_KEY, state);
  sessionStorage.setItem(PENDING_URL_STORAGE_KEY, pendingUrl);

  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES,
  });

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/**
 * Call once on app load. If the current URL is the return leg of a login
 * redirect (`?code=...&state=...` or `?error=...`), exchanges the code for
 * tokens, clears the query string, and returns the pending URL that was
 * stashed before redirecting — or `null` for any page load this doesn't
 * apply to (a normal load, or a rejected/failed consent screen).
 */
export async function handleRedirectCallback(): Promise<string | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (!code && !error) return null;

  history.replaceState(null, '', url.origin + url.pathname);

  const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  const pendingUrl = sessionStorage.getItem(PENDING_URL_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_URL_STORAGE_KEY);

  if (error || !code || !verifier || !returnedState || returnedState !== expectedState) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: import.meta.env.VITE_SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string' || typeof json.refresh_token !== 'string' || typeof json.expires_in !== 'number') {
      return null;
    }

    writeStoredTokens({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    });

    return pendingUrl;
  } catch {
    return null;
  }
}

/** Refreshes and persists a new access token using the stored refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<StoredTokens | null> {
  const body = new URLSearchParams({
    client_id: import.meta.env.VITE_SPOTIFY_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
      return null;
    }
    if (json.refresh_token !== undefined && typeof json.refresh_token !== 'string') {
      return null;
    }

    const tokens: StoredTokens = {
      accessToken: json.access_token,
      // Spotify doesn't always return a new refresh token — keep the old one if absent.
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    writeStoredTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Returns a currently-valid access token, refreshing first if needed.
 * Returns null if there's no session, or the refresh itself failed (e.g. the
 * user revoked access) — callers should treat that as "logged out".
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = readStoredTokens();
  if (!tokens) return null;

  if (Date.now() < tokens.expiresAt - EXPIRY_SAFETY_MARGIN_MS) {
    return tokens.accessToken;
  }

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  if (!refreshed) {
    logout();
    return null;
  }
  return refreshed.accessToken;
}
