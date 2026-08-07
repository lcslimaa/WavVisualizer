import type { ButterchurnPreset, LoadedPreset } from '../butterchurn/engine';
import { showToast } from './controls';

/** Wires the "Load preset…" button + hidden file input for loading Butterchurn/MilkDrop .json presets. */
export function setupPresetLoader(onPresetsLoaded: (presets: LoadedPreset[]) => void): void {
  const loadBtn = document.getElementById('load-preset-btn') as HTMLButtonElement | null;
  const input = document.getElementById('load-preset-input') as HTMLInputElement | null;
  if (!loadBtn || !input) return;

  loadBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // allow re-selecting the same file later

    const loaded: LoadedPreset[] = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const preset = JSON.parse(text) as ButterchurnPreset;
        if (!isLikelyButterchurnPreset(preset)) {
          throw new Error('Missing expected preset fields (baseVals, warp, comp).');
        }
        loaded.push({ name: presetNameFromFile(file.name), preset });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't load "${file.name}": ${message}`);
      }
    }

    if (loaded.length > 0) onPresetsLoaded(loaded);
  });
}

/** Disables the loader when Butterchurn/WebGL2 isn't usable in this browser. */
export function disablePresetLoader(reason: string): void {
  const loadBtn = document.getElementById('load-preset-btn') as HTMLButtonElement | null;
  if (!loadBtn) return;
  loadBtn.disabled = true;
  loadBtn.title = reason;
}

export interface ShuffleCallbacks {
  onToggle: () => void;
  onIntervalChange: (seconds: number) => void;
}

/** Wires the random auto-cycle toggle + its interval (seconds) input. */
export function setupShuffleControls(callbacks: ShuffleCallbacks): void {
  const toggleBtn = document.getElementById('shuffle-toggle-btn') as HTMLButtonElement | null;
  const intervalInput = document.getElementById('shuffle-interval-input') as HTMLInputElement | null;

  toggleBtn?.addEventListener('click', () => callbacks.onToggle());

  intervalInput?.addEventListener('change', () => {
    const seconds = clampIntervalSeconds(Number(intervalInput.value));
    intervalInput.value = String(seconds);
    callbacks.onIntervalChange(seconds);
  });
}

function clampIntervalSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 15;
  return Math.min(600, Math.max(3, Math.round(seconds)));
}

export function setShuffleActive(active: boolean): void {
  document.getElementById('shuffle-toggle-btn')?.classList.toggle('active', active);
}

/** Enabled once there are at least 2 loaded Butterchurn presets to randomize between. */
export function setShuffleAvailable(available: boolean): void {
  const toggleBtn = document.getElementById('shuffle-toggle-btn') as HTMLButtonElement | null;
  if (toggleBtn) {
    toggleBtn.disabled = !available;
    toggleBtn.title = available
      ? 'Randomly cycle loaded Butterchurn presets'
      : 'Load at least 2 Butterchurn presets to enable auto-cycle';
  }
}

export function getShuffleIntervalSeconds(): number {
  const intervalInput = document.getElementById('shuffle-interval-input') as HTMLInputElement | null;
  return clampIntervalSeconds(Number(intervalInput?.value ?? 15));
}

// warp/comp shaders are always present in real Butterchurn presets (they're
// how the preset actually renders); rejecting their absence here surfaces a
// clear "malformed file" message immediately, rather than an opaque crash
// from Butterchurn's own parser later when the preset is first activated.
function isLikelyButterchurnPreset(value: unknown): value is ButterchurnPreset {
  return (
    typeof value === 'object' &&
    value !== null &&
    'baseVals' in value &&
    typeof (value as Record<string, unknown>).warp === 'string' &&
    typeof (value as Record<string, unknown>).comp === 'string'
  );
}

function presetNameFromFile(filename: string): string {
  return filename.replace(/\.json$/i, '');
}
