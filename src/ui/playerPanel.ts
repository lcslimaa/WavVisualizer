import type { TrackInfo } from '../media/types';
import { showToast } from './controls';
import { isSpotifyUrl } from '../spotify/url';

export interface PlayerPanelCallbacks {
  onPlayRequested: (url: string) => Promise<void>;
  onToggleClick: () => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onVolumeChange: (volume: number) => void;
  onSeek: (fraction: number) => void;
  onSpotifyLoginClick: () => void;
}

let idlePlayButtonLabel = 'Play';

/** Wires the "paste a link" forms, Spotify login button, Now Playing toggle, queue nav, and volume slider. */
export function setupPlayerPanel(callbacks: PlayerPanelCallbacks): void {
  // The overlay form starts a session from the front page.
  bindLinkForm('soundcloud-form', 'soundcloud-url', 'soundcloud-play-btn', callbacks, () => idlePlayButtonLabel);

  // The sidebar's form is how you add to an already-playing queue — it's
  // only reachable once the player shell is showing (the overlay form
  // covers the pre-session "start" case).
  bindLinkForm('queue-add-form', 'queue-add-url', 'queue-add-submit-btn', callbacks, () => 'Add');

  const toggleBtn = document.getElementById('now-playing-toggle') as HTMLButtonElement | null;
  const prevBtn = document.getElementById('queue-prev-btn') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('queue-next-btn') as HTMLButtonElement | null;
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
  const spotifyLoginBtn = document.getElementById('spotify-login-btn') as HTMLButtonElement | null;
  const spotifyLoginBtnSidebar = document.getElementById('spotify-login-btn-sidebar') as HTMLButtonElement | null;

  toggleBtn?.addEventListener('click', () => callbacks.onToggleClick());
  prevBtn?.addEventListener('click', () => callbacks.onPrevTrack());
  nextBtn?.addEventListener('click', () => callbacks.onNextTrack());
  volumeSlider?.addEventListener('input', () => {
    callbacks.onVolumeChange(Number(volumeSlider.value));
  });
  spotifyLoginBtn?.addEventListener('click', () => callbacks.onSpotifyLoginClick());
  spotifyLoginBtnSidebar?.addEventListener('click', () => callbacks.onSpotifyLoginClick());

  setupProgressBar(callbacks);
}

/** Click or drag the progress bar to seek; visual feedback is immediate, the actual seek fires on release. */
function setupProgressBar(callbacks: PlayerPanelCallbacks): void {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;

  let dragging = false;
  let pendingFraction = 0;

  const fractionFromEvent = (e: PointerEvent): number => {
    const rect = bar.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    return rect.width > 0 ? x / rect.width : 0;
  };

  bar.addEventListener('pointerdown', (e) => {
    if (bar.classList.contains('disabled')) return;
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    pendingFraction = fractionFromEvent(e);
    setProgressVisual(pendingFraction);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pendingFraction = fractionFromEvent(e);
    setProgressVisual(pendingFraction);
  });
  bar.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    callbacks.onSeek(pendingFraction);
  });
}

/** Wires one "paste a link" form: validates, disables inputs while pending, resets on success/failure. */
function bindLinkForm(
  formId: string,
  inputId: string,
  submitBtnId: string,
  callbacks: PlayerPanelCallbacks,
  getIdleLabel: () => string
): void {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const submitBtn = document.getElementById(submitBtnId) as HTMLButtonElement | null;

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input?.value.trim() ?? '';
    if (!isLikelySoundCloudUrl(url) && !isSpotifyUrl(url)) {
      showToast("That doesn't look like a SoundCloud or Spotify link.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Loading…';
    }
    if (input) input.disabled = true;

    try {
      await callbacks.onPlayRequested(url);
      if (input) input.value = '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = getIdleLabel();
      }
      if (input) input.disabled = false;
    }
  });
}

function isLikelySoundCloudUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

/**
 * Shows or hides the "Log in with Spotify" button — visible only while a
 * Spotify link is waiting on login. There are two instances in the DOM (one
 * in the pre-session overlay form, one in the sidebar's add-to-queue form)
 * since only one is ever visible at a time depending on whether a session
 * is active — both are toggled together so whichever is reachable shows up.
 */
export function showSpotifyLoginPrompt(show: boolean): void {
  document.getElementById('spotify-login-btn')?.classList.toggle('hidden', !show);
  document.getElementById('spotify-login-btn-sidebar')?.classList.toggle('hidden', !show);
}

/** Fills the paste-a-link inputs with `url` without submitting — used to resume after a Spotify login redirect. */
export function prefillLinkInput(url: string): void {
  const overlayInput = document.getElementById('soundcloud-url') as HTMLInputElement | null;
  if (overlayInput) overlayInput.value = url;
  const sidebarInput = document.getElementById('queue-add-url') as HTMLInputElement | null;
  if (sidebarInput) sidebarInput.value = url;
}

/** Labels the Now Playing mini panel with which provider is currently active. */
export function setNowPlayingSource(label: 'SoundCloud' | 'Spotify'): void {
  const el = document.getElementById('now-playing-source');
  if (el) el.textContent = label;
}

export function showNowPlaying(info: TrackInfo): void {
  const mini = document.getElementById('now-playing-mini');
  const art = document.getElementById('now-playing-art') as HTMLImageElement | null;
  const caption = document.getElementById('now-playing-title');

  if (caption) caption.textContent = `NOW PLAYING: ${info.title}`;
  if (art) {
    if (info.artworkUrl) {
      art.src = info.artworkUrl;
      art.style.visibility = 'visible';
    } else {
      art.removeAttribute('src');
      art.style.visibility = 'hidden';
    }
  }

  mini?.classList.remove('hidden');
  setNowPlayingToggleState(true);

  setProgressEnabled(true);
  setProgress(0, 0, info.durationMs);
}

export function hideNowPlaying(): void {
  document.getElementById('now-playing-mini')?.classList.add('hidden');
  const caption = document.getElementById('now-playing-title');
  if (caption) caption.textContent = '';
  setProgressEnabled(false);
}

/** Called on every playback progress tick to advance the bar and time labels. */
export function setProgress(relativePosition: number, currentPositionMs: number, durationMs: number): void {
  setProgressVisual(relativePosition);
  const currentEl = document.getElementById('progress-time-current');
  const totalEl = document.getElementById('progress-time-total');
  if (currentEl) currentEl.textContent = formatTime(currentPositionMs);
  if (totalEl) totalEl.textContent = formatTime(durationMs);
}

/** Enabled once a track is active — there's no "position" concept for raw system audio. */
export function setProgressEnabled(enabled: boolean): void {
  const bar = document.getElementById('progress-bar');
  bar?.classList.toggle('disabled', !enabled);
  bar?.setAttribute('tabindex', enabled ? '0' : '-1');
  if (!enabled) {
    setProgressVisual(0);
    const currentEl = document.getElementById('progress-time-current');
    const totalEl = document.getElementById('progress-time-total');
    if (currentEl) currentEl.textContent = '0:00';
    if (totalEl) totalEl.textContent = '0:00';
  }
}

function setProgressVisual(fraction: number): void {
  const clamped = Math.max(0, Math.min(1, fraction));
  const pct = `${clamped * 100}%`;
  const fill = document.getElementById('progress-bar-fill');
  const handle = document.getElementById('progress-bar-handle');
  if (fill) fill.style.width = pct;
  if (handle) handle.style.left = pct;
  document.getElementById('progress-bar')?.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function setNowPlayingToggleState(playing: boolean): void {
  const toggleBtn = document.getElementById('now-playing-toggle');
  if (!toggleBtn) return;
  toggleBtn.innerHTML = playing ? '&#9208;' : '&#9654;'; // pause : play glyphs
  toggleBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

/** e.g. setQueueCounter(2, 4) shows "2 / 4". */
export function setQueueCounter(current: number, total: number): void {
  const el = document.getElementById('queue-counter');
  if (el) el.textContent = `${current} / ${total}`;
}

export function setQueueNavEnabled(hasPrev: boolean, hasNext: boolean): void {
  const prevBtn = document.getElementById('queue-prev-btn') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('queue-next-btn') as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = !hasPrev;
  if (nextBtn) nextBtn.disabled = !hasNext;
}

export interface PlaylistEntry {
  label: string;
}

/** Renders the sidebar playlist list — click a row to jump straight to that track. */
export function renderPlaylist(entries: PlaylistEntry[], currentIndex: number, onSelect: (index: number) => void): void {
  const list = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  if (countEl) countEl.textContent = String(entries.length);
  if (!list) return;

  list.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playlist-empty';
    empty.textContent = 'Nothing queued yet — paste a link above.';
    list.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'playlist-item' + (index === currentIndex ? ' current' : '');
    item.textContent = `${index === currentIndex ? '▶ ' : ''}${String(index + 1).padStart(2, '0')}. ${entry.label}`;
    item.addEventListener('click', () => onSelect(index));
    list.appendChild(item);
  });
}

/** Switches the submit button's idle label between starting fresh vs. adding to an active queue. */
export function setPlayButtonMode(mode: 'play' | 'queue'): void {
  idlePlayButtonLabel = mode === 'queue' ? 'Add to Queue' : 'Play';
  const playBtn = document.getElementById('soundcloud-play-btn') as HTMLButtonElement | null;
  if (playBtn && !playBtn.disabled) playBtn.textContent = idlePlayButtonLabel;
}

/** Resets the URL inputs and login prompt, e.g. after going Home. */
export function resetPlayerForm(): void {
  const input = document.getElementById('soundcloud-url') as HTMLInputElement | null;
  if (input) input.value = '';
  setPlayButtonMode('play');
  showSpotifyLoginPrompt(false);
}
