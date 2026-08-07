import type { TrackInfo } from '../soundcloud/widget';
import { showToast } from './controls';

export interface SoundCloudPanelCallbacks {
  onPlayRequested: (url: string) => Promise<void>;
  onToggleClick: () => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onVolumeChange: (volume: number) => void;
}

let idlePlayButtonLabel = 'Play';

/** Wires the "paste a SoundCloud link" forms, Now Playing toggle, queue nav, and volume slider. */
export function setupSoundCloudPanel(callbacks: SoundCloudPanelCallbacks): void {
  // The overlay form starts a session from the front page.
  bindSoundCloudForm(
    'soundcloud-form',
    'soundcloud-url',
    'soundcloud-play-btn',
    callbacks,
    () => idlePlayButtonLabel
  );

  // The Now Playing card's collapsible form is how you add to an already-
  // playing queue — the overlay form is hidden once something's playing.
  bindSoundCloudForm(
    'queue-add-form',
    'queue-add-url',
    'queue-add-submit-btn',
    callbacks,
    () => 'Add',
    collapseQueueAddForm
  );

  const toggleBtn = document.getElementById('now-playing-toggle') as HTMLButtonElement | null;
  const prevBtn = document.getElementById('queue-prev-btn') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('queue-next-btn') as HTMLButtonElement | null;
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
  const addToggleBtn = document.getElementById('queue-add-toggle-btn') as HTMLButtonElement | null;

  toggleBtn?.addEventListener('click', () => callbacks.onToggleClick());
  prevBtn?.addEventListener('click', () => callbacks.onPrevTrack());
  nextBtn?.addEventListener('click', () => callbacks.onNextTrack());
  volumeSlider?.addEventListener('input', () => {
    callbacks.onVolumeChange(Number(volumeSlider.value));
  });

  addToggleBtn?.addEventListener('click', () => {
    const addForm = document.getElementById('queue-add-form');
    const isHidden = addForm?.classList.toggle('hidden');
    if (isHidden === false) {
      (document.getElementById('queue-add-url') as HTMLInputElement | null)?.focus();
    }
  });
}

/** Wires one "paste a link" form: validates, disables inputs while pending, resets on success/failure. */
function bindSoundCloudForm(
  formId: string,
  inputId: string,
  submitBtnId: string,
  callbacks: SoundCloudPanelCallbacks,
  getIdleLabel: () => string,
  onSuccess?: () => void
): void {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const submitBtn = document.getElementById(submitBtnId) as HTMLButtonElement | null;

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input?.value.trim() ?? '';
    if (!isLikelySoundCloudUrl(url)) {
      showToast("That doesn't look like a SoundCloud track link.");
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
      onSuccess?.();
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

function collapseQueueAddForm(): void {
  document.getElementById('queue-add-form')?.classList.add('hidden');
}

function isLikelySoundCloudUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

export function showNowPlaying(info: TrackInfo): void {
  const card = document.getElementById('now-playing');
  const art = document.getElementById('now-playing-art') as HTMLImageElement | null;
  const title = document.getElementById('now-playing-title');

  if (title) title.textContent = info.title;
  if (art) {
    if (info.artworkUrl) {
      art.src = info.artworkUrl;
      art.style.visibility = 'visible';
    } else {
      art.removeAttribute('src');
      art.style.visibility = 'hidden';
    }
  }

  card?.classList.remove('hidden');
  setNowPlayingToggleState(true);
}

export function hideNowPlaying(): void {
  document.getElementById('now-playing')?.classList.add('hidden');
  collapseQueueAddForm();
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

/** Switches the submit button's idle label between starting fresh vs. adding to an active queue. */
export function setPlayButtonMode(mode: 'play' | 'queue'): void {
  idlePlayButtonLabel = mode === 'queue' ? 'Add to Queue' : 'Play';
  const playBtn = document.getElementById('soundcloud-play-btn') as HTMLButtonElement | null;
  if (playBtn && !playBtn.disabled) playBtn.textContent = idlePlayButtonLabel;
}

/** Resets the URL input, e.g. after going Home. */
export function resetSoundCloudForm(): void {
  const input = document.getElementById('soundcloud-url') as HTMLInputElement | null;
  if (input) input.value = '';
  setPlayButtonMode('play');
  collapseQueueAddForm();
}
