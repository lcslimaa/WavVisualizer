import './style.css';
import { AudioCapture } from './audio/capture';
import { visualizers } from './visualizers/registry';
import type { Visualizer, Size } from './visualizers/types';
import { ButterchurnEngine } from './butterchurn/engine';
import type { ButterchurnPreset, LoadedPreset } from './butterchurn/engine';
import { isButterchurnSupported } from './butterchurn/support';
import { setupControls, showOverlay, showHud, setPresetName, showToast, resetShareButton } from './ui/controls';
import {
  setupPresetLoader,
  disablePresetLoader,
  setupShuffleControls,
  setShuffleActive,
  setShuffleAvailable,
  getShuffleIntervalSeconds,
} from './ui/presetLoader';
import { SoundCloudPlayer } from './soundcloud/widget';
import {
  setupSoundCloudPanel,
  showNowPlaying,
  hideNowPlaying,
  setNowPlayingToggleState,
  setQueueCounter,
  setQueueNavEnabled,
  setPlayButtonMode,
  resetSoundCloudForm,
  renderPlaylist,
  setProgress,
} from './ui/soundcloudPanel';

interface QueueTrack {
  url: string;
  title?: string;
}

function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const slug = path.split('/').pop() || url;
    return decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim() || url;
  } catch {
    return url;
  }
}

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
const soundCloudPlayer = new SoundCloudPlayer();
let soundCloudPlaying = false;
let scQueue: QueueTrack[] = [];
let scQueueIndex = -1;
let currentTrackDurationMs = 0;

const slots: Slot[] = visualizers.map((visualizer) => ({ engine: 'canvas2d', visualizer }));

let currentIndex = 0;
let lastTime = 0;
let rafHandle = 0;
let shuffleActive = false;
let shuffleTimerHandle = 0;

function currentSize(): Size {
  return { w: canvas2d.width, h: canvas2d.height };
}

/** The canvases live inside this bordered LCD panel now, not the full viewport. */
const visualizerPanel = document.querySelector('.visualizer-panel') as HTMLElement;

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = visualizerPanel.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  for (const c of [canvas2d, glCanvas]) {
    c.width = w;
    c.height = h;
    c.style.width = `${rect.width}px`;
    c.style.height = `${rect.height}px`;
  }
  const slot = slots[currentIndex];
  if (slot?.engine === 'canvas2d') slot.visualizer.resize(currentSize());
  if (butterchurnEngine.isInitialized) butterchurnEngine.resize(currentSize());
}

/**
 * Lazily (re)initializes Butterchurn against the *current* capture session.
 * Each AudioCapture.start() creates a brand-new AudioContext, so this must
 * be checked every time a Butterchurn preset is loaded or activated —
 * `butterchurnEngine` is disposed on every new session in `onCaptureReady()`,
 * which is what makes `isInitialized` false again after a session switch.
 */
function ensureButterchurnInitialized(): boolean {
  if (butterchurnEngine.isInitialized) return true;

  const audioCtx = capture.getAudioContext();
  const sourceNode = capture.getSourceNode();
  if (!audioCtx || !sourceNode) {
    showToast('Share audio first, then load a preset.');
    return false;
  }

  try {
    butterchurnEngine.init(audioCtx, glCanvas, currentSize(), sourceNode);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Couldn't start the Butterchurn engine: ${message}`);
    return false;
  }
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
    if (ensureButterchurnInitialized()) {
      try {
        butterchurnEngine.loadPreset(slot.preset, 1.5);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`"${slot.name}" failed to load: ${message}`);
      }
    }
    setPresetName(slot.name);
  }
}

function stepPreset(direction: 1 | -1): void {
  activateSlot(currentIndex + direction);
  if (shuffleActive) startShuffleTimer(); // manual nav resets the countdown
}

/** Butterchurn slots are always contiguous from visualizers.length onward. */
function getButterchurnSlotIndices(): number[] {
  const indices: number[] = [];
  for (let i = visualizers.length; i < slots.length; i++) indices.push(i);
  return indices;
}

function pickRandomButterchurnIndex(excludeIndex: number): number | null {
  const indices = getButterchurnSlotIndices();
  if (indices.length === 0) return null;
  // Avoid re-picking the same preset back to back when there's a choice.
  const pool = indices.length > 1 ? indices.filter((i) => i !== excludeIndex) : indices;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffleTick(): void {
  const next = pickRandomButterchurnIndex(currentIndex);
  if (next !== null) activateSlot(next);
}

function stopShuffleTimer(): void {
  window.clearInterval(shuffleTimerHandle);
  shuffleTimerHandle = 0;
}

function startShuffleTimer(): void {
  stopShuffleTimer();
  shuffleTimerHandle = window.setInterval(shuffleTick, getShuffleIntervalSeconds() * 1000);
}

function toggleShuffle(): void {
  shuffleActive = !shuffleActive;
  if (shuffleActive) startShuffleTimer();
  else stopShuffleTimer();
  setShuffleActive(shuffleActive);
}

function handleShuffleIntervalChange(): void {
  if (shuffleActive) startShuffleTimer(); // restart with the new interval
}

/** Only enabled once there are at least 2 loaded Butterchurn presets to randomize between. */
function updateShuffleAvailability(): void {
  const available = getButterchurnSlotIndices().length >= 2;
  setShuffleAvailable(available);
  if (!available && shuffleActive) {
    shuffleActive = false;
    stopShuffleTimer();
    setShuffleActive(false);
  }
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
  if (!ensureButterchurnInitialized()) return;

  const firstNewIndex = slots.length;
  for (const { name, preset } of loaded) {
    slots.push({ engine: 'butterchurn', name, preset });
  }
  activateSlot(firstNewIndex);
  updateShuffleAvailability();
}

/** Common "we now have live audio" sequence, shared by every capture entry point. */
function onCaptureReady(): void {
  // Each new session gets a brand-new AudioContext (see AudioCapture.start()) —
  // disposing here means any already-loaded Butterchurn preset slot gets
  // lazily reconnected to the fresh audio graph next time it's activated,
  // instead of staying silently wired to the previous, now-closed context.
  butterchurnEngine.dispose();
  showOverlay(false);
  showHud(true);
  resizeCanvas();
  activateSlot(0, { first: true });
  lastTime = 0;
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(tick);
}

function resetSoundCloudQueue(): void {
  scQueue = [];
  scQueueIndex = -1;
}

async function startVisualizing(): Promise<void> {
  soundCloudPlayer.dispose();
  hideNowPlaying();
  resetSoundCloudQueue();
  setPlayButtonMode('play');
  await capture.start();
  onCaptureReady();
}

function handleSoundCloudPlayStateChange(playing: boolean): void {
  soundCloudPlaying = playing;
  setNowPlayingToggleState(playing);
}

function updateQueueUI(): void {
  setQueueCounter(scQueueIndex + 1, scQueue.length);
  setQueueNavEnabled(scQueueIndex > 0, scQueueIndex < scQueue.length - 1);
  renderPlaylist(
    scQueue.map((track) => ({ label: track.title ?? titleFromUrl(track.url) })),
    scQueueIndex,
    jumpToQueueTrack
  );
}

function jumpToQueueTrack(index: number): void {
  if (index === scQueueIndex) return;
  loadQueueTrack(index).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

/** Loads and plays the queue item at `index` — used for the initial track and every prev/next/auto-advance/click. */
async function loadQueueTrack(index: number): Promise<void> {
  const track = scQueue[index];
  if (!track) return;

  const info = await soundCloudPlayer.load(track.url);
  track.title = info.title;
  currentTrackDurationMs = info.durationMs;
  scQueueIndex = index;
  soundCloudPlayer.play();
  // Rebound every load() — a fresh widget instance is created each time.
  soundCloudPlayer.onPlayStateChange(handleSoundCloudPlayStateChange);
  soundCloudPlayer.onFinish(playNextInQueue);
  soundCloudPlayer.onProgress((progress) => {
    setProgress(progress.relativePosition, progress.currentPositionMs, currentTrackDurationMs);
  });
  soundCloudPlaying = true;
  showNowPlaying(info);
  updateQueueUI();
}

function handleSeek(fraction: number): void {
  soundCloudPlayer.seekTo(fraction, currentTrackDurationMs);
}

function playNextInQueue(): void {
  if (scQueueIndex >= scQueue.length - 1) return;
  loadQueueTrack(scQueueIndex + 1).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

function playPrevInQueue(): void {
  if (scQueueIndex <= 0) return;
  loadQueueTrack(scQueueIndex - 1).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

async function startFromSoundCloud(url: string): Promise<void> {
  if (scQueue.length > 0) {
    // Already playing from SoundCloud — queue it instead of restarting capture.
    scQueue.push({ url });
    updateQueueUI();
    showToast('Added to queue.');
    return;
  }

  // Request tab-audio capture FIRST, while the click's user-activation is
  // still fresh — before touching the SoundCloud widget, which needs its
  // own network round-trip to load. If the user cancels the picker, we
  // never mount anything that couldn't be visualized.
  await capture.start({ preferCurrentTab: true });

  scQueue = [{ url }];
  try {
    await loadQueueTrack(0);
    setPlayButtonMode('queue');
    onCaptureReady();
  } catch (err) {
    capture.stop();
    resetSoundCloudQueue();
    throw err;
  }
}

function toggleSoundCloudPlayback(): void {
  if (soundCloudPlaying) soundCloudPlayer.pause();
  else soundCloudPlayer.play();
}

function handleVolumeChange(volume: number): void {
  soundCloudPlayer.setVolume(volume);
}

/** Returns to the front-page overlay from any state (Share-Audio or SoundCloud session). */
function goHome(): void {
  cancelAnimationFrame(rafHandle);
  stopShuffleTimer();
  shuffleActive = false;
  setShuffleActive(false);
  const slot = slots[currentIndex];
  if (slot?.engine === 'canvas2d') slot.visualizer.dispose();
  butterchurnEngine.dispose();
  capture.stop();
  soundCloudPlayer.dispose();
  hideNowPlaying();
  resetSoundCloudQueue();
  updateQueueUI();
  resetSoundCloudForm();
  resetShareButton();
  showHud(false);
  showOverlay(true);
}

window.addEventListener('resize', resizeCanvas);

setupControls({
  onShareRequested: startVisualizing,
  onPresetStep: stepPreset,
  onHomeClick: goHome,
});

setupSoundCloudPanel({
  onPlayRequested: startFromSoundCloud,
  onToggleClick: toggleSoundCloudPlayback,
  onPrevTrack: playPrevInQueue,
  onNextTrack: playNextInQueue,
  onVolumeChange: handleVolumeChange,
  onSeek: handleSeek,
});

setupPresetLoader(handleLoadedPresets);
if (!webglSupported) {
  disablePresetLoader(
    "This browser doesn't support WebGL2, required for Butterchurn/MilkDrop presets."
  );
}

setupShuffleControls({
  onToggle: toggleShuffle,
  onIntervalChange: handleShuffleIntervalChange,
});
updateShuffleAvailability();

resizeCanvas();
