import type { MediaSource, ProgressInfo, TrackInfo } from '../media/types';
import { getValidAccessToken, logout } from './auth';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const WEB_API_BASE = 'https://api.spotify.com/v1';
const PROGRESS_TICK_MS = 250;
const READY_TIMEOUT_MS = 12000;

export interface ContextInfo {
  tracks: TrackInfo[];
  initialIndex: number;
}

let sdkLoadPromise: Promise<void> | null = null;

/** Loads the Web Playback SDK <script> once and resolves once window.Spotify is ready. */
function loadPlaybackSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  const promise = new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error("Couldn't load the Spotify player."));
    document.head.appendChild(script);
  });
  sdkLoadPromise = promise;
  promise.catch(() => {
    sdkLoadPromise = null;
  });
  return promise;
}

interface SpotifyApiSimplifiedTrack {
  uri: string;
  name: string;
  duration_ms: number;
}

interface SpotifyApiFullTrack extends SpotifyApiSimplifiedTrack {
  album: { images: { url: string }[] };
}

interface SpotifyApiTrackItem {
  track: SpotifyApiFullTrack | null;
}

interface SpotifyApiPagedTracks {
  items: (SpotifyApiTrackItem | SpotifyApiSimplifiedTrack)[];
  next: string | null;
}

interface SpotifyApiErrorBody {
  error?: { reason?: string; message?: string };
}

/** Manages a single (reused) Web Playback SDK connection for in-app Spotify playback. */
export class SpotifyPlayer implements MediaSource {
  private player: SpotifyPlayerInstance | null = null;
  private deviceId: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private currentContextUri: string | null = null;
  private contextTrackUris: string[] = [];
  private volume = 100;

  private trackChangeCb: ((info: TrackInfo, index: number) => void) | null = null;
  private playStateCb: ((playing: boolean) => void) | null = null;
  private progressCb: ((info: ProgressInfo) => void) | null = null;
  private errorCb: ((message: string) => void) | null = null;
  private finishCb: (() => void) | null = null;

  private lastKnownState: { position: number; duration: number; paused: boolean; timestamp: number } | null = null;
  private progressTimer = 0;
  private wasNearEnd = false;
  private lastTrackUri: string | null = null;

  /** Fires on any post-connect Spotify error (Premium required, expired session, playback rejected). */
  onError(cb: (message: string) => void): void {
    this.errorCb = cb;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    const promise = (async () => {
      await loadPlaybackSdk();
      const Spotify = window.Spotify!;

      const player = new Spotify.Player({
        name: 'WavVisualizer',
        getOAuthToken: (cb) => {
          getValidAccessToken().then((token) => {
            if (token) cb(token);
          });
        },
        volume: this.volume / 100,
      });
      this.player = player;

      player.addListener('player_state_changed', (state) => this.handleStateChanged(state));
      player.addListener('account_error', () => {
        this.errorCb?.('Spotify playback requires Premium — your account is on the Free plan.');
      });
      player.addListener('authentication_error', () => {
        logout();
        this.errorCb?.('Your Spotify session expired — please log in again.');
      });
      player.addListener('initialization_error', () => {
        this.errorCb?.("Couldn't start the Spotify player in this browser.");
      });
      player.addListener('playback_error', () => {
        this.errorCb?.("This can't be played on Spotify.");
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error('Took too long to connect to Spotify.'));
        }, READY_TIMEOUT_MS);
        player.addListener('ready', ({ device_id }) => {
          window.clearTimeout(timeout);
          this.deviceId = device_id;
          resolve();
        });
        player.connect();
      });

      this.startProgressTimer();
    })();

    this.connectPromise = promise;
    promise.catch(() => {
      this.connectPromise = null;
    });
    return promise;
  }

  private handleStateChanged(state: SpotifyPlaybackState | null): void {
    if (!state) return;

    this.lastKnownState = {
      position: state.position,
      duration: state.duration,
      paused: state.paused,
      timestamp: performance.now(),
    };

    this.playStateCb?.(!state.paused);

    const uri = state.track_window.current_track.uri;
    if (uri !== this.lastTrackUri) {
      this.wasNearEnd = false;
      this.lastTrackUri = uri;
    }

    const index = this.contextTrackUris.indexOf(uri);
    this.trackChangeCb?.(
      {
        title: state.track_window.current_track.name,
        artworkUrl: state.track_window.current_track.album.images[0]?.url ?? null,
        durationMs: state.duration,
      },
      index
    );
  }

  private startProgressTimer(): void {
    window.clearInterval(this.progressTimer);
    this.progressTimer = window.setInterval(() => {
      if (!this.lastKnownState) return;
      const { position, duration, paused, timestamp } = this.lastKnownState;
      const elapsed = paused ? 0 : performance.now() - timestamp;
      const currentPositionMs = Math.min(duration, position + elapsed);

      if (this.progressCb) {
        this.progressCb({
          relativePosition: duration > 0 ? currentPositionMs / duration : 0,
          currentPositionMs,
        });
      }

      if (this.finishCb) {
        if (!paused && duration > 1000 && currentPositionMs >= duration - 1000) {
          this.wasNearEnd = true;
        }
        if (paused && currentPositionMs === 0 && this.wasNearEnd) {
          this.wasNearEnd = false;
          this.finishCb();
        }
      }
    }, PROGRESS_TICK_MS);
  }

  private async webApiRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getValidAccessToken();
    if (!token) throw new Error('Please log in with Spotify first.');
    return fetch(`${WEB_API_BASE}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  }

  /** Turns a failed playback-start response into the right user-facing message (Premium-required gets special wording). */
  private async playbackErrorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as SpotifyApiErrorBody;
      if (body.error?.reason === 'PREMIUM_REQUIRED') {
        return 'Spotify playback requires Premium — your account is on the Free plan.';
      }
      if (body.error?.message) return body.error.message;
    } catch {
      // fall through to the generic message below
    }
    return "Couldn't start playback on Spotify.";
  }

  /** Loads and plays a single track URI, resolving with its title/artwork/duration. */
  async loadTrack(uri: string): Promise<TrackInfo> {
    await this.ensureConnected();
    this.currentContextUri = null;
    this.contextTrackUris = [];

    const id = uri.split(':').pop()!;
    const metaRes = await this.webApiRequest(`/tracks/${id}`);
    if (!metaRes.ok) throw new Error("This track can't be played — it may be unavailable in your region.");
    const meta = (await metaRes.json()) as {
      name: string;
      duration_ms: number;
      album: { images: { url: string }[] };
    };

    const playRes = await this.webApiRequest(`/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (!playRes.ok) throw new Error(await this.playbackErrorMessage(playRes));

    return {
      title: meta.name,
      artworkUrl: meta.album.images[0]?.url ?? null,
      durationMs: meta.duration_ms,
    };
  }

  /** Loads a playlist/album URI, fetching every track's metadata upfront and starting playback from the first. */
  async loadContext(contextUri: string): Promise<ContextInfo> {
    await this.ensureConnected();
    const tracks = await this.fetchContextTracks(contextUri);
    if (tracks.length === 0) throw new Error('This playlist has no playable tracks.');

    this.currentContextUri = contextUri;
    await this.playContext(contextUri, 0);

    return { tracks, initialIndex: 0 };
  }

  private async playContext(contextUri: string, offset: number): Promise<void> {
    const res = await this.webApiRequest(`/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_uri: contextUri, offset: { position: offset } }),
    });
    if (!res.ok) throw new Error(await this.playbackErrorMessage(res));
  }

  private async fetchContextTracks(contextUri: string): Promise<TrackInfo[]> {
    const [, type, id] = contextUri.split(':');
    const isAlbum = type === 'album';
    const kind = isAlbum ? 'albums' : 'playlists';

    // Albums don't repeat their artwork per-track (unlike playlists' per-item
    // album.images) — fetch it once upfront and reuse it for every track.
    let albumArtworkUrl: string | null = null;
    if (isAlbum) {
      const albumRes = await this.webApiRequest(`/albums/${id}`);
      if (albumRes.ok) {
        const albumMeta = (await albumRes.json()) as { images: { url: string }[] };
        albumArtworkUrl = albumMeta.images[0]?.url ?? null;
      }
    }

    let path: string | null = `/${kind}/${id}/tracks?limit=50`;
    const uris: string[] = [];
    const tracks: TrackInfo[] = [];

    while (path) {
      const res = await this.webApiRequest(path);
      if (!res.ok) throw new Error("This playlist can't be loaded — it may be private or unavailable.");
      const page = (await res.json()) as SpotifyApiPagedTracks;

      for (const rawItem of page.items) {
        // Playlist items wrap the track in `{ track: ... }` (and it can be
        // null for local files / regionally unavailable items); album items
        // are the (simplified) track object directly.
        const track = isAlbum
          ? (rawItem as SpotifyApiSimplifiedTrack)
          : (rawItem as SpotifyApiTrackItem).track;
        if (!track || !track.uri || !track.name || typeof track.duration_ms !== 'number') continue;

        uris.push(track.uri);
        tracks.push({
          title: track.name,
          artworkUrl: isAlbum ? albumArtworkUrl : ((track as SpotifyApiFullTrack).album?.images?.[0]?.url ?? null),
          durationMs: track.duration_ms,
        });
      }

      path = page.next ? page.next.replace(WEB_API_BASE, '') : null;
    }

    this.contextTrackUris = uris;
    return tracks;
  }

  play(): void {
    this.player?.resume();
  }

  pause(): void {
    this.player?.pause();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.player?.setVolume(volume / 100);
  }

  seekTo(fraction: number, durationMs: number): void {
    this.player?.seek(Math.max(0, Math.min(1, fraction)) * durationMs);
  }

  next(): void {
    this.player?.nextTrack();
  }

  prev(): void {
    this.player?.previousTrack();
  }

  /** Only meaningful in 'set' mode — jumps to `index` within the currently loaded context. */
  skipTo(index: number): void {
    if (!this.currentContextUri) return;
    this.playContext(this.currentContextUri, index).catch((err) => {
      this.errorCb?.(err instanceof Error ? err.message : String(err));
    });
  }

  onPlayStateChange(cb: (playing: boolean) => void): void {
    this.playStateCb = cb;
  }

  onTrackChange(cb: (info: TrackInfo, index: number) => void): void {
    this.trackChangeCb = cb;
  }

  onProgress(cb: (info: ProgressInfo) => void): void {
    this.progressCb = cb;
  }

  /**
   * Fires once when a single (non-context) track finishes — the SDK has no
   * dedicated "ended" event, so this heuristically detects it: playback
   * stops at position 0 having previously been near the track's end. Only
   * meaningful in queue mode, where a lone URI is loaded with nothing queued
   * to auto-advance to; context mode (playlists/albums) doesn't use this —
   * mirrors how SoundCloud's onFinish is only bound in loadQueueTrack, never
   * in Set mode.
   */
  onFinish(cb: () => void): void {
    this.finishCb = cb;
  }

  dispose(): void {
    window.clearInterval(this.progressTimer);
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this.connectPromise = null;
    this.currentContextUri = null;
    this.contextTrackUris = [];
    this.lastKnownState = null;
    this.finishCb = null;
    this.lastTrackUri = null;
    this.wasNearEnd = false;
  }
}
