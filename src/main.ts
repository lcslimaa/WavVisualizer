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
import type { MediaSource, TrackInfo } from './media/types';
import {
  setupPlayerPanel,
  showNowPlaying,
  hideNowPlaying,
  setNowPlayingToggleState,
  setQueueCounter,
  setQueueNavEnabled,
  setPlayButtonMode,
  resetPlayerForm,
  renderPlaylist,
  setProgress,
  showSpotifyLoginPrompt,
  prefillLinkInput,
  setNowPlayingSource,
} from './ui/playerPanel';
import { SpotifyPlayer } from './spotify/player';
import { parseSpotifyUrl, toSpotifyUri, type SpotifyLink } from './spotify/url';
import { login as spotifyLogin, isLoggedIn, handleRedirectCallback } from './spotify/auth';

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

/** Both soundcloud.com/user/sets/name and soundcloud.com/discover/sets/... match. */
function isSetUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes('/sets/');
  } catch {
    return false;
  }
}

function detectProvider(url: string): 'soundcloud' | 'spotify' | null {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com')) return 'soundcloud';
    if (hostname === 'open.spotify.com') return 'spotify';
    return null;
  } catch {
    return null;
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
const spotifyPlayer = new SpotifyPlayer();
spotifyPlayer.onError((message) => showToast(message));
let sourcePlaying = false;
// Set while the "Log in with Spotify" button is showing — the link that
// triggered it, so the button's click handler knows what to resume once
// login() redirects back.
let spotifyLoginPendingUrl: string | null = null;

/**
 * The single active playback session, generalized across providers.
 * `queue`/`queueIndex` are used in 'queue' mode (individually pasted links,
 * app-managed advance); `setTracks`/`setIndex` are used in 'set' mode (a
 * playlist/album/Set the underlying player navigates natively). `sessionId`
 * guards against a delayed async callback (e.g. SoundCloud's backfill poll)
 * from a session the user has since replaced or left applying its results
 * late.
 */
interface ActiveSource {
  provider: 'soundcloud' | 'spotify';
  player: MediaSource;
  mode: 'queue' | 'set';
  queue: QueueTrack[];
  queueIndex: number;
  setTracks: TrackInfo[];
  setIndex: number;
  durationMs: number;
  sessionId: number;
}

let activeSource: ActiveSource | null = null;
let nextSessionId = 0;

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

function resetPlaybackSession(): void {
  activeSource = null;
}

async function startVisualizing(): Promise<void> {
  soundCloudPlayer.dispose();
  spotifyPlayer.dispose();
  hideNowPlaying();
  resetPlaybackSession();
  setPlayButtonMode('play');
  await capture.start();
  onCaptureReady();
}

function handleSourcePlayStateChange(playing: boolean): void {
  sourcePlaying = playing;
  setNowPlayingToggleState(playing);
}

function updatePlayerUI(): void {
  if (!activeSource) {
    setQueueCounter(0, 0);
    setQueueNavEnabled(false, false);
    renderPlaylist([], -1, () => {});
    return;
  }

  if (activeSource.mode === 'set') {
    setQueueCounter(activeSource.setIndex + 1, activeSource.setTracks.length);
    setQueueNavEnabled(activeSource.setIndex > 0, activeSource.setIndex < activeSource.setTracks.length - 1);
    renderPlaylist(
      activeSource.setTracks.map((track) => ({ label: track.title })),
      activeSource.setIndex,
      jumpToSetTrack
    );
  } else {
    setQueueCounter(activeSource.queueIndex + 1, activeSource.queue.length);
    setQueueNavEnabled(activeSource.queueIndex > 0, activeSource.queueIndex < activeSource.queue.length - 1);
    renderPlaylist(
      activeSource.queue.map((track) => ({ label: track.title ?? titleFromUrl(track.url) })),
      activeSource.queueIndex,
      jumpToQueueTrack
    );
  }
}

function jumpToQueueTrack(index: number): void {
  if (!activeSource || index === activeSource.queueIndex) return;
  loadQueueTrack(index).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

function jumpToSetTrack(index: number): void {
  if (!activeSource || index === activeSource.setIndex) return;
  activeSource.player.skipTo(index);
}

/**
 * Binds the handlers that keep the UI in sync with a Set/playlist/album's
 * internal playback. Provider-agnostic: works for both a SoundCloud Set
 * (rebound after every loadSet() call, since a fresh widget instance is
 * created each time) and a Spotify context (bound once per loadContext()
 * call against the same persistent SpotifyPlayer). onTrackChange is what
 * keeps the title in sync as the underlying player auto-advances.
 */
function bindSetTrackChangeHandlers(player: MediaSource): void {
  // Deliberately no onFinish binding here (unlike loadQueueTrack): onFinish
  // exists to trigger *our* manual advance-to-next-queue-item logic, which
  // doesn't apply in Set mode — the underlying player advances through the
  // playlist/Set on its own, and onTrackChange (below) is what picks up
  // each resulting track change. Provider-agnostic: called for both a
  // SoundCloud Set and a Spotify playlist/album context.
  player.onPlayStateChange(handleSourcePlayStateChange);
  player.onTrackChange((info, index) => {
    if (!activeSource) return;
    // SoundCloud's onTrackChange fires only on genuine track transitions,
    // but Spotify's underlying event (player_state_changed) also fires on
    // plain pause/resume/seek with the same track — without this check,
    // every one of those would snap the progress bar to 0 and rebuild the
    // sidebar's scroll position. Skip the redraw when nothing changed.
    // -1 (a duplicate or market-relinked track Spotify couldn't resolve to
    // a known index) is deliberately ignored rather than assigned, so it
    // doesn't clear the current highlight/counter.
    const unchanged =
      activeSource.setIndex === index &&
      activeSource.durationMs === info.durationMs &&
      activeSource.setTracks[index]?.title === info.title;
    if (index >= 0) activeSource.setIndex = index;
    activeSource.durationMs = info.durationMs;
    if (!unchanged) {
      showNowPlaying(info);
      updatePlayerUI();
    }
  });
  player.onProgress((progress) => {
    if (!activeSource) return;
    setProgress(progress.relativePosition, progress.currentPositionMs, activeSource.durationMs);
  });
}

async function startQueueFresh(url: string): Promise<void> {
  const sessionId = ++nextSessionId;
  activeSource = {
    provider: 'soundcloud',
    player: soundCloudPlayer,
    mode: 'queue',
    queue: [{ url }],
    queueIndex: -1,
    setTracks: [],
    setIndex: -1,
    durationMs: 0,
    sessionId,
  };
  await loadQueueTrack(0);
}

async function startSet(url: string): Promise<void> {
  const sessionId = ++nextSessionId;
  const { tracks, initialIndex } = await soundCloudPlayer.loadSet(url);
  activeSource = {
    provider: 'soundcloud',
    player: soundCloudPlayer,
    mode: 'set',
    queue: [],
    queueIndex: -1,
    setTracks: tracks,
    setIndex: initialIndex,
    durationMs: 0,
    sessionId,
  };
  bindSetTrackChangeHandlers(soundCloudPlayer);
  soundCloudPlayer.play();
  sourcePlaying = true;
  // Shows immediately from the Set's track list; onTrackChange corrects
  // durationMs (0 here, a placeholder — see loadSet's doc comment) once the
  // first PLAY event fires.
  showNowPlaying(tracks[initialIndex]);
  setNowPlayingSource('SoundCloud');
  updatePlayerUI();
  scheduleSetTrackRefresh(sessionId);
}

async function startSpotifyQueueFresh(url: string): Promise<void> {
  const sessionId = ++nextSessionId;
  activeSource = {
    provider: 'spotify',
    player: spotifyPlayer,
    mode: 'queue',
    queue: [{ url }],
    queueIndex: -1,
    setTracks: [],
    setIndex: -1,
    durationMs: 0,
    sessionId,
  };
  await loadQueueTrack(0);
}

async function startSpotifySet(link: SpotifyLink): Promise<void> {
  const sessionId = ++nextSessionId;
  const contextUri = toSpotifyUri(link);
  const { tracks, initialIndex } = await spotifyPlayer.loadContext(contextUri);
  activeSource = {
    provider: 'spotify',
    player: spotifyPlayer,
    mode: 'set',
    queue: [],
    queueIndex: -1,
    setTracks: tracks,
    setIndex: initialIndex,
    durationMs: 0,
    sessionId,
  };
  bindSetTrackChangeHandlers(spotifyPlayer);
  spotifyPlayer.play();
  sourcePlaying = true;
  showNowPlaying(tracks[initialIndex]);
  setNowPlayingSource('Spotify');
  updatePlayerUI();
}

async function startFromSpotify(url: string): Promise<void> {
  const link = parseSpotifyUrl(url);
  if (!link) {
    showToast("That doesn't look like a Spotify link.");
    return;
  }

  if (!isLoggedIn()) {
    spotifyLoginPendingUrl = url;
    showSpotifyLoginPrompt(true);
    return;
  }

  if (activeSource?.provider === 'spotify' && activeSource.mode === 'queue' && link.type === 'track') {
    activeSource.queue.push({ url });
    updatePlayerUI();
    showToast('Added to queue.');
    return;
  }

  disposeStalePlayer('spotify');

  const alreadyCapturing = capture.isActive && activeSource !== null;
  if (!alreadyCapturing) {
    await capture.start({ preferCurrentTab: true });
  }

  try {
    if (link.type === 'track') {
      await startSpotifyQueueFresh(url);
    } else {
      await startSpotifySet(link);
    }
  } catch (err) {
    if (!alreadyCapturing) capture.stop();
    spotifyPlayer.dispose();
    resetPlaybackSession();
    hideNowPlaying();
    updatePlayerUI();
    setPlayButtonMode('play');
    // See the identical comment in startFromSoundCloud's catch block.
    if (alreadyCapturing) goHome();
    throw err;
  }

  setPlayButtonMode(activeSource?.mode === 'queue' ? 'queue' : 'play');
  if (!alreadyCapturing) onCaptureReady();
}

function handleSpotifyLoginClick(): void {
  if (!spotifyLoginPendingUrl) return;
  spotifyLogin(spotifyLoginPendingUrl).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

/**
 * A large Set's track list often isn't fully resolved the instant loadSet()
 * returns — SoundCloud fills in later entries' titles/artwork over the next
 * several seconds, so an initial getSounds() call can come back with several
 * "Unknown track" placeholders. Poll a few more times with backoff and
 * backfill whatever resolves, stopping once nothing's left unresolved or
 * after a handful of attempts. `sessionId` guards against a stale timer from
 * a Set the user has since replaced or left applying its results late.
 * SoundCloud-specific (see refreshSounds()'s doc comment) — Spotify's
 * context tracks arrive fully resolved upfront via the Web API, so this
 * backfill-poll pattern has no Spotify equivalent.
 */
function scheduleSetTrackRefresh(sessionId: number, attempt = 0): void {
  const delays = [1500, 3000, 5000, 8000];
  if (attempt >= delays.length) return;

  window.setTimeout(async () => {
    if (!activeSource || activeSource.sessionId !== sessionId || activeSource.mode !== 'set') return;

    const refreshed = await soundCloudPlayer.refreshSounds();
    if (!activeSource || activeSource.sessionId !== sessionId || activeSource.mode !== 'set') return;

    let changed = false;
    let stillUnresolved = false;
    activeSource.setTracks = activeSource.setTracks.map((track, index) => {
      const fresh = refreshed[index];
      if (track.title !== 'Unknown track' || !fresh) return track;
      if (fresh.title === 'Unknown track') {
        stillUnresolved = true;
        return track;
      }
      changed = true;
      return { ...track, title: fresh.title, artworkUrl: fresh.artworkUrl };
    });

    if (changed) updatePlayerUI();
    if (stillUnresolved) scheduleSetTrackRefresh(sessionId, attempt + 1);
  }, delays[attempt]);
}

/** Loads and plays the queue item at `index` — used for the initial track and every prev/next/auto-advance/click. */
async function loadQueueTrack(index: number): Promise<void> {
  if (!activeSource) return;
  const track = activeSource.queue[index];
  if (!track) return;

  let info: TrackInfo;
  if (activeSource.provider === 'spotify') {
    const link = parseSpotifyUrl(track.url);
    if (!link) throw new Error('Invalid Spotify link.');
    info = await spotifyPlayer.loadTrack(toSpotifyUri(link));
  } else {
    info = await soundCloudPlayer.load(track.url);
  }

  track.title = info.title;
  activeSource.durationMs = info.durationMs;
  activeSource.queueIndex = index;
  activeSource.player.play();
  activeSource.player.onPlayStateChange(handleSourcePlayStateChange);
  activeSource.player.onFinish(playNextInQueue);
  activeSource.player.onProgress((progress) => {
    if (!activeSource) return;
    setProgress(progress.relativePosition, progress.currentPositionMs, activeSource.durationMs);
  });
  sourcePlaying = true;
  showNowPlaying(info);
  setNowPlayingSource(activeSource.provider === 'spotify' ? 'Spotify' : 'SoundCloud');
  updatePlayerUI();
}

function handleSeek(fraction: number): void {
  if (!activeSource) return;
  activeSource.player.seekTo(fraction, activeSource.durationMs);
}

function playNextInQueue(): void {
  if (!activeSource || activeSource.queueIndex >= activeSource.queue.length - 1) return;
  loadQueueTrack(activeSource.queueIndex + 1).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

function playPrevInQueue(): void {
  if (!activeSource || activeSource.queueIndex <= 0) return;
  loadQueueTrack(activeSource.queueIndex - 1).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}

function playNextTrack(): void {
  if (activeSource?.mode === 'set') {
    if (activeSource.setIndex < activeSource.setTracks.length - 1) activeSource.player.next();
  } else {
    playNextInQueue();
  }
}

function playPrevTrack(): void {
  if (activeSource?.mode === 'set') {
    if (activeSource.setIndex > 0) activeSource.player.prev();
  } else {
    playPrevInQueue();
  }
}

async function startFromSoundCloud(url: string): Promise<void> {
  if (activeSource?.provider === 'soundcloud' && activeSource.mode === 'queue' && !isSetUrl(url)) {
    // Already playing a queue — add to it instead of restarting capture.
    activeSource.queue.push({ url });
    updatePlayerUI();
    showToast('Added to queue.');
    return;
  }

  disposeStalePlayer('soundcloud');

  // A Set can't be appended to (SoundCloud's widget has no such method) —
  // any new paste while one's active replaces it. If we're already
  // capturing (an active Set, or a plain Share-Audio session with no
  // SoundCloud track yet), reuse that capture instead of requesting a new
  // one — re-requesting would show another share picker unnecessarily.
  const alreadyCapturing = capture.isActive && activeSource !== null;
  if (!alreadyCapturing) {
    // Request tab-audio capture FIRST, while the click's user-activation is
    // still fresh — before touching the SoundCloud widget, which needs its
    // own network round-trip to load. If the user cancels the picker, we
    // never mount anything that couldn't be visualized.
    await capture.start({ preferCurrentTab: true });
  }

  try {
    if (isSetUrl(url)) {
      await startSet(url);
    } else {
      await startQueueFresh(url);
    }
  } catch (err) {
    if (!alreadyCapturing) capture.stop();
    soundCloudPlayer.dispose();
    resetPlaybackSession();
    hideNowPlaying();
    updatePlayerUI();
    setPlayButtonMode('play');
    // If capture was reused from a still-live session that we just disposed
    // (a cross-provider switch), a failure here leaves capture running with
    // nothing playing and no visible way back — go all the way Home instead
    // of leaving a silent, empty player shell up.
    if (alreadyCapturing) goHome();
    throw err;
  }

  setPlayButtonMode(activeSource?.mode === 'queue' ? 'queue' : 'play');
  if (!alreadyCapturing) onCaptureReady();
}

async function startFromLink(url: string): Promise<void> {
  showSpotifyLoginPrompt(false);
  const provider = detectProvider(url);
  if (!provider) {
    showToast("That doesn't look like a SoundCloud or Spotify link.");
    return;
  }

  if (provider === 'soundcloud') {
    await startFromSoundCloud(url);
  } else {
    await startFromSpotify(url);
  }
}

/**
 * Disposes the other provider's player if a session is currently active
 * under a different provider than `provider` — called only after the
 * caller's own early-return guards (parse failure, Spotify login-required,
 * same-provider queue-append) have passed, so a request that bails out
 * early never silently kills audio still playing under the other provider.
 */
function disposeStalePlayer(provider: 'soundcloud' | 'spotify'): void {
  if (activeSource && activeSource.provider !== provider) {
    activeSource.player.dispose();
  }
}

function toggleSoundCloudPlayback(): void {
  if (!activeSource) return;
  if (sourcePlaying) activeSource.player.pause();
  else activeSource.player.play();
}

function handleVolumeChange(volume: number): void {
  // Unconditional (not gated on activeSource): both players persist and
  // remember their volume regardless of whether a track is currently
  // loaded (see SoundCloudPlayer.setVolume's doc comment) — the slider is
  // reachable during a plain Share-Audio session too, before any track has
  // loaded, and that adjustment must still apply once one does.
  soundCloudPlayer.setVolume(volume);
  spotifyPlayer.setVolume(volume);
}

/** Returns to the front-page overlay from any state (Share-Audio, SoundCloud, or Spotify session). */
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
  spotifyPlayer.dispose();
  hideNowPlaying();
  resetPlaybackSession();
  updatePlayerUI();
  resetPlayerForm();
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

setupPlayerPanel({
  onPlayRequested: startFromLink,
  onToggleClick: toggleSoundCloudPlayback,
  onPrevTrack: playPrevTrack,
  onNextTrack: playNextTrack,
  onVolumeChange: handleVolumeChange,
  onSeek: handleSeek,
  onSpotifyLoginClick: handleSpotifyLoginClick,
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

// If this load is the return leg of a Spotify login redirect, prefill the
// link that triggered it rather than auto-playing: getDisplayMedia requires
// a fresh user gesture, which a page load returning from a redirect doesn't
// reliably carry, so one more explicit click on Play provides it.
handleRedirectCallback()
  .then((pendingUrl) => {
    if (pendingUrl) {
      prefillLinkInput(pendingUrl);
      showToast('Logged in with Spotify — click Play to start.');
    }
  })
  .catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
