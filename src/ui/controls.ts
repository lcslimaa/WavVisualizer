export interface ControlsCallbacks {
  onShareRequested: () => Promise<void>;
  onPresetStep: (direction: 1 | -1) => void;
  onHomeClick: () => void;
}

/** Wires up DOM controls: Share Audio button, preset prev/next (+ arrow keys), fullscreen toggle, Home. */
export function setupControls(callbacks: ControlsCallbacks): void {
  const shareBtn = document.getElementById('share-btn') as HTMLButtonElement | null;
  const prevBtn = document.getElementById('preset-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('preset-next') as HTMLButtonElement | null;
  const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
  const homeBtn = document.getElementById('home-btn') as HTMLButtonElement | null;
  const app = document.getElementById('app');

  shareBtn?.addEventListener('click', async () => {
    shareBtn.disabled = true;
    shareBtn.textContent = 'Requesting…';
    try {
      await callbacks.onShareRequested();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showError(message);
      shareBtn.disabled = false;
      shareBtn.textContent = 'Share Audio';
    }
  });

  prevBtn?.addEventListener('click', () => callbacks.onPresetStep(-1));
  nextBtn?.addEventListener('click', () => callbacks.onPresetStep(1));

  fullscreenBtn?.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      app?.requestFullscreen().catch(() => {});
    }
  });

  homeBtn?.addEventListener('click', () => callbacks.onHomeClick());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') callbacks.onPresetStep(1);
    if (e.key === 'ArrowLeft') callbacks.onPresetStep(-1);
    if (e.key === 'f' || e.key === 'F') fullscreenBtn?.click();
    if (e.key === 'Escape') homeBtn?.click();
  });
}

function showError(message: string): void {
  const overlayInner = document.querySelector('.overlay-inner');
  if (!overlayInner) return;
  let errorEl = overlayInner.querySelector('.error') as HTMLParagraphElement | null;
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'error';
    overlayInner.appendChild(errorEl);
  }
  errorEl.textContent = message;
}

export function showOverlay(show: boolean): void {
  document.getElementById('overlay')?.classList.toggle('hidden', !show);
}

export function showHud(show: boolean): void {
  document.getElementById('hud')?.classList.toggle('hidden', !show);
}

export function setPresetName(name: string): void {
  const el = document.getElementById('preset-name');
  if (el) el.textContent = name;
}

/** Restores the Share Audio button to its idle state, e.g. after going Home (it's left disabled/"Requesting…" on success since the overlay hides immediately). */
export function resetShareButton(): void {
  const shareBtn = document.getElementById('share-btn') as HTMLButtonElement | null;
  if (!shareBtn) return;
  shareBtn.disabled = false;
  shareBtn.textContent = 'Share Audio';
}

let toastTimer = 0;

/** Shows a transient error/info message near the HUD (for post-share errors, e.g. a bad preset file). */
export function showToast(message: string, durationMs = 4000): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), durationMs);
}
