import './style.css';
import { AudioCapture } from './audio/capture';
import { visualizers } from './visualizers/registry';
import type { Visualizer, Size } from './visualizers/types';
import { ButterchurnEngine } from './butterchurn/engine';
import type { ButterchurnPreset, LoadedPreset } from './butterchurn/engine';
import { isButterchurnSupported } from './butterchurn/support';
import { setupControls, showOverlay, showHud, setPresetName, showToast } from './ui/controls';
import { setupPresetLoader, disablePresetLoader } from './ui/presetLoader';

/**
 * A "slot" is one entry in the unified, cyclable preset list. The first
 * `visualizers.length` slots are our hand-built Canvas2D presets; any
 * further slots are Butterchurn presets appended as the user loads them.
 */
type Slot =
  | { engine: 'canvas2d'; visualizer: Visualizer }
  | { engine: 'butterchurn'; name: string; preset: ButterchurnPreset };

const canvas2d = document.getElementById('viz') as HTMLCanvasElement;
const glCanvas = document.getElementById('viz-gl') as HTMLCanvasElement;
const ctx = canvas2d.getContext('2d');
if (!ctx) throw new Error('Canvas 2D context not available');

const capture = new AudioCapture();
const butterchurnEngine = new ButterchurnEngine();
const webglSupported = isButterchurnSupported();

const slots: Slot[] = visualizers.map((visualizer) => ({ engine: 'canvas2d', visualizer }));

let currentIndex = 0;
let lastTime = 0;
let rafHandle = 0;

function currentSize(): Size {
  return { w: canvas2d.width, h: canvas2d.height };
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  for (const c of [canvas2d, glCanvas]) {
    c.width = w;
    c.height = h;
    c.style.width = `${window.innerWidth}px`;
    c.style.height = `${window.innerHeight}px`;
  }
  const slot = slots[currentIndex];
  if (slot?.engine === 'canvas2d') slot.visualizer.resize(currentSize());
  if (butterchurnEngine.isInitialized) butterchurnEngine.resize(currentSize());
}

function activateSlot(index: number, opts: { first?: boolean } = {}): void {
  const prev = slots[currentIndex];
  if (!opts.first && prev?.engine === 'canvas2d') prev.visualizer.dispose();

  currentIndex = ((index % slots.length) + slots.length) % slots.length;
  const slot = slots[currentIndex];

  canvas2d.classList.toggle('hidden', slot.engine !== 'canvas2d');
  glCanvas.classList.toggle('hidden', slot.engine !== 'butterchurn');

  if (slot.engine === 'canvas2d') {
    slot.visualizer.init(ctx!, currentSize());
    setPresetName(slot.visualizer.name);
  } else {
    try {
      butterchurnEngine.loadPreset(slot.preset, 1.5);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`"${slot.name}" failed to load: ${message}`);
    }
    setPresetName(slot.name);
  }
}

function stepPreset(direction: 1 | -1): void {
  activateSlot(currentIndex + direction);
}

function tick(time: number): void {
  const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0;
  lastTime = time;

  const slot = slots[currentIndex];
  if (slot?.engine === 'canvas2d') {
    const frame = capture.getFrameData();
    if (frame) slot.visualizer.render(frame, dt);
  } else if (slot?.engine === 'butterchurn') {
    butterchurnEngine.render();
  }

  rafHandle = requestAnimationFrame(tick);
}

function handleLoadedPresets(loaded: LoadedPreset[]): void {
  const audioCtx = capture.getAudioContext();
  const sourceNode = capture.getSourceNode();
  if (!audioCtx || !sourceNode) {
    showToast('Share audio first, then load a preset.');
    return;
  }

  try {
    if (!butterchurnEngine.isInitialized) {
      butterchurnEngine.init(audioCtx, glCanvas, currentSize(), sourceNode);
    }

    const firstNewIndex = slots.length;
    for (const { name, preset } of loaded) {
      slots.push({ engine: 'butterchurn', name, preset });
    }
    activateSlot(firstNewIndex);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Couldn't start the Butterchurn engine: ${message}`);
  }
}

async function startVisualizing(): Promise<void> {
  await capture.start();
  showOverlay(false);
  showHud(true);
  resizeCanvas();
  activateSlot(0, { first: true });
  lastTime = 0;
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(tick);
}

window.addEventListener('resize', resizeCanvas);

setupControls({
  onShareRequested: startVisualizing,
  onPresetStep: stepPreset,
});

setupPresetLoader(handleLoadedPresets);
if (!webglSupported) {
  disablePresetLoader(
    "This browser doesn't support WebGL2, required for Butterchurn/MilkDrop presets."
  );
}

resizeCanvas();
