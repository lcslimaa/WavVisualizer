# SoundCloud Set Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste a SoundCloud Set (playlist) URL and have it play as a real multi-track playlist, fixing the current bug where pasting a Set URL plays through it via SoundCloud's own native behavior while the app's title/artwork/progress UI stays frozen on the first track.

**Architecture:** Add a second playback mode, `set`, alongside the existing `queue` mode. Set mode loads the URL into SoundCloud's native "multi-sound" widget (`getSounds()`/`next()`/`prev()`/`skip()`) instead of our app-managed track array, and relies on a `PLAY`-event-triggered metadata refresh (`onTrackChange`) to keep the UI in sync as the widget auto-advances — there is no dedicated "track changed" event in SoundCloud's Widget API, so `PLAY` (which already fires reliably per SoundCloud's docs) is the most reliable available signal.

**Tech Stack:** TypeScript, SoundCloud Widget API (`https://w.soundcloud.com/player/api.js`, loaded at runtime, no npm package). No new dependencies.

## Global Constraints

- No unit test framework exists in this project — verification is `npx tsc --noEmit` / `npm run build` plus live manual testing in Chrome via the claude-in-chrome MCP tools, the established pattern for every prior feature in this codebase.
- Do not add any new npm dependency — everything needed is already available through the existing `SC.Widget` surface.
- `src/ui/soundcloudPanel.ts`, `index.html`, and `src/style.css` need **no changes** — this feature is pure playback-logic wiring in `src/soundcloud/*` and `src/main.ts`, reusing existing UI functions (`renderPlaylist`, `showNowPlaying`, `setQueueCounter`, `setQueueNavEnabled`, `setPlayButtonMode`, `setProgress`) as-is.
- Do not push to GitHub / open a PR — user explicitly asked to hold off. Local commits on the existing `feature/soundcloud-sets` branch only.
- Test URL: `https://soundcloud.com/soundcloud/sets/creator-radio` (confirmed real, embeddable, official SoundCloud set — use this, not the algorithmic `/discover/sets/...` page, which is unconfirmed).

---

### Task 1: Extend ambient SoundCloud Widget types for multi-sound widgets

**Files:**
- Modify: `src/soundcloud/types.d.ts`

**Interfaces:**
- Consumes: nothing (pure type declarations)
- Produces: `SCWidget.getSounds`, `SCWidget.getCurrentSoundIndex`, `SCWidget.next`, `SCWidget.prev`, `SCWidget.skip` — consumed by Task 2

- [ ] **Step 1: Add the four multi-sound-widget methods to the `SCWidget` interface**

In `src/soundcloud/types.d.ts`, the `SCWidget` interface currently ends with `seekTo`. Add these four methods right after it (before the closing `}`):

```typescript
interface SCWidget {
  bind(eventName: string, callback: (data?: unknown) => void): void;
  unbind(eventName: string): void;
  play(): void;
  pause(): void;
  getCurrentSound(callback: (sound: SCWidgetSound | null) => void): void;
  /** 0-100. */
  setVolume(volume: number): void;
  /** 0-100. */
  getVolume(callback: (volume: number) => void): void;
  /** Milliseconds. */
  getDuration(callback: (durationMs: number) => void): void;
  /** Milliseconds. */
  seekTo(milliseconds: number): void;
  /** Only meaningful for a widget loaded with a Set/playlist URL. */
  getSounds(callback: (sounds: SCWidgetSound[]) => void): void;
  /** Only meaningful for a widget loaded with a Set/playlist URL. */
  getCurrentSoundIndex(callback: (index: number) => void): void;
  /** Skips to the next sound. Only for multi-sound (Set) widgets. */
  next(): void;
  /** Skips to the previous sound. Only for multi-sound (Set) widgets. */
  prev(): void;
  /** Jumps to the sound at `soundIndex` (0-based). Only for multi-sound (Set) widgets. */
  skip(soundIndex: number): void;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this is a pure type addition, nothing consumes these members yet).

- [ ] **Step 3: Commit**

```bash
git add src/soundcloud/types.d.ts
git commit -m "Add multi-sound widget types (getSounds, skip, next, prev)"
```

---

### Task 2: Add Set loading + track navigation to `SoundCloudPlayer`

**Files:**
- Modify: `src/soundcloud/widget.ts`

**Interfaces:**
- Consumes: `SCWidget.getSounds`, `SCWidget.getCurrentSoundIndex`, `SCWidget.next`, `SCWidget.prev`, `SCWidget.skip` (Task 1)
- Produces:
  - `SoundCloudPlayer.loadSet(setUrl: string): Promise<SetInfo>` where `SetInfo = { tracks: TrackInfo[]; initialIndex: number }`
  - `SoundCloudPlayer.next(): void`, `.prev(): void`, `.skipTo(index: number): void`
  - `SoundCloudPlayer.onTrackChange(cb: (info: TrackInfo, index: number) => void): void`
  - These are consumed by Task 3.

This task also refactors `load()` to share its iframe/timeout/error-handling setup with the new `loadSet()`, via a private `createReadyWidget()` helper — both methods need the identical "create iframe, wait for READY or ERROR or timeout" dance, and duplicating it would violate DRY.

- [ ] **Step 1: Add the `SetInfo` type export**

In `src/soundcloud/widget.ts`, right after the existing `ProgressInfo` interface, add:

```typescript
export interface SetInfo {
  tracks: TrackInfo[];
  initialIndex: number;
}
```

- [ ] **Step 2: Extract the shared "create + wait for ready" logic into `createReadyWidget`**

Replace the current `load()` method body. Find this in the `SoundCloudPlayer` class:

```typescript
  /** Loads a track URL into the embed and resolves with its title/artwork once playable. */
  async load(trackUrl: string): Promise<TrackInfo> {
    await loadWidgetApi();
    this.teardown();

    const iframe = document.createElement('iframe');
    iframe.className = 'soundcloud-embed';
    iframe.allow = 'autoplay';
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(trackUrl)}&auto_play=true&show_artwork=false&visual=false`;
    document.body.appendChild(iframe);
    this.iframe = iframe;

    const SC = window.SC!;
    const widget = SC.Widget(iframe);
    this.widget = widget;

    return new Promise<TrackInfo>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Track took too long to load — it may not be public or embeddable.'));
      }, READY_TIMEOUT_MS);

      widget.bind(SC.Widget.Events.ERROR, () => {
        window.clearTimeout(timeout);
        reject(new Error("This track can't be played — it may be private or restricted."));
      });

      widget.bind(SC.Widget.Events.READY, () => {
        window.clearTimeout(timeout);
        widget.setVolume(this.volume);
        widget.getCurrentSound((sound) => {
          widget.getDuration((durationMs) => {
            resolve({
              title: sound?.title ?? 'Unknown track',
              artworkUrl: sound?.artwork_url ?? null,
              durationMs,
            });
          });
        });
      });
    });
  }
```

Replace it with:

```typescript
  /** Loads a track URL into the embed and resolves with its title/artwork once playable. */
  async load(trackUrl: string): Promise<TrackInfo> {
    const widget = await this.createReadyWidget(trackUrl);
    return new Promise<TrackInfo>((resolve) => {
      widget.getCurrentSound((sound) => {
        widget.getDuration((durationMs) => {
          resolve({
            title: sound?.title ?? 'Unknown track',
            artworkUrl: sound?.artwork_url ?? null,
            durationMs,
          });
        });
      });
    });
  }

  /**
   * Loads a Set/playlist URL as a multi-sound widget and resolves with every
   * track's title/artwork plus which one is initially active. Per-track
   * `durationMs` is 0 for entries other than the initially active one —
   * SoundCloud's sound-list objects don't include duration, only the
   * currently-active sound does (via getDuration()). The active track's real
   * duration arrives via onTrackChange once playback starts.
   */
  async loadSet(setUrl: string): Promise<SetInfo> {
    const widget = await this.createReadyWidget(setUrl);
    return new Promise<SetInfo>((resolve, reject) => {
      widget.getSounds((sounds) => {
        if (!sounds || sounds.length === 0) {
          reject(new Error('This playlist has no playable tracks.'));
          return;
        }
        widget.getCurrentSoundIndex((initialIndex) => {
          const tracks = sounds.map((sound) => ({
            title: sound?.title ?? 'Unknown track',
            artworkUrl: sound?.artwork_url ?? null,
            durationMs: 0,
          }));
          resolve({ tracks, initialIndex: initialIndex ?? 0 });
        });
      });
    });
  }

  /** Shared by load()/loadSet(): mounts a fresh embed for `url` and resolves once it's playable. */
  private async createReadyWidget(url: string): Promise<SCWidget> {
    await loadWidgetApi();
    this.teardown();

    const iframe = document.createElement('iframe');
    iframe.className = 'soundcloud-embed';
    iframe.allow = 'autoplay';
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&show_artwork=false&visual=false`;
    document.body.appendChild(iframe);
    this.iframe = iframe;

    const SC = window.SC!;
    const widget = SC.Widget(iframe);
    this.widget = widget;

    return new Promise<SCWidget>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Took too long to load — it may not be public or embeddable.'));
      }, READY_TIMEOUT_MS);

      widget.bind(SC.Widget.Events.ERROR, () => {
        window.clearTimeout(timeout);
        reject(new Error("This can't be played — it may be private or restricted."));
      });

      widget.bind(SC.Widget.Events.READY, () => {
        window.clearTimeout(timeout);
        widget.setVolume(this.volume);
        resolve(widget);
      });
    });
  }
```

- [ ] **Step 3: Add `next`/`prev`/`skipTo`/`onTrackChange` methods**

Still in the `SoundCloudPlayer` class, add these after the existing `seekTo` method (before `private teardown()`):

```typescript
  /** Set-mode only: skips to the next track in the loaded Set. */
  next(): void {
    this.widget?.next();
  }

  /** Set-mode only: skips to the previous track in the loaded Set. */
  prev(): void {
    this.widget?.prev();
  }

  /** Set-mode only: jumps directly to the track at `index` (0-based). */
  skipTo(index: number): void {
    this.widget?.skip(index);
  }

  /**
   * Set-mode only: fires whenever playback (re)starts, re-fetching fresh
   * track metadata each time. This is how the UI learns a Set auto-advanced
   * to a new track — SoundCloud's Widget API has no dedicated "track
   * changed" event, so PLAY (which fires reliably on every track start,
   * including auto-advance within a Set) is the most reliable signal
   * available. Deliberately separate from onPlayStateChange so Queue mode
   * (which doesn't need this) isn't affected.
   */
  onTrackChange(cb: (info: TrackInfo, index: number) => void): void {
    const SC = window.SC;
    const widget = this.widget;
    if (!widget || !SC) return;
    widget.bind(SC.Widget.Events.PLAY, () => {
      widget.getCurrentSound((sound) => {
        widget.getCurrentSoundIndex((index) => {
          widget.getDuration((durationMs) => {
            cb(
              { title: sound?.title ?? 'Unknown track', artworkUrl: sound?.artwork_url ?? null, durationMs },
              index ?? 0
            );
          });
        });
      });
    });
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds, same as any prior successful build in this project.

- [ ] **Step 6: Manual regression check — single-track load still works**

This step only refactored `load()`, so confirm it didn't break. Start the dev server and verify a single track still plays correctly (this exercises `createReadyWidget` + `load()`):

```bash
npm run dev -- --port 5193
```

Using the claude-in-chrome MCP tools (mock `getDisplayMedia` with a real oscillator the same way every prior SoundCloud feature in this project was tested — see any earlier commit's testing notes for the exact mock snippet), paste `https://soundcloud.com/forss/flickermood` into the overlay form and confirm:
- Title/artwork/duration appear correctly in the Now Playing UI
- Progress bar advances
- No console errors

Stop the dev server after confirming.

- [ ] **Step 7: Commit**

```bash
git add src/soundcloud/widget.ts
git commit -m "Add SoundCloudPlayer.loadSet/next/prev/skipTo/onTrackChange"
```

---

### Task 3: Wire Set mode into `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes:
  - `SoundCloudPlayer.loadSet(url): Promise<SetInfo>`, `.next()`, `.prev()`, `.skipTo(index)`, `.onTrackChange(cb)` (Task 2)
  - Existing UI functions from `src/ui/soundcloudPanel.ts`: `renderPlaylist(entries, currentIndex, onSelect)`, `showNowPlaying(info)`, `setQueueCounter(current, total)`, `setQueueNavEnabled(hasPrev, hasNext)`, `setPlayButtonMode(mode)`, `setProgress(relativePosition, currentPositionMs, durationMs)` — all unchanged, already imported.
- Produces: nothing consumed elsewhere — this is the top-level wiring.

- [ ] **Step 1: Add `scMode` state and Set-mode arrays, and import `TrackInfo`**

Find this line near the top of `src/main.ts`:

```typescript
import { SoundCloudPlayer } from './soundcloud/widget';
```

Replace it with:

```typescript
import { SoundCloudPlayer, type TrackInfo } from './soundcloud/widget';
```

Find this block:

```typescript
let soundCloudPlaying = false;
let scQueue: QueueTrack[] = [];
let scQueueIndex = -1;
let currentTrackDurationMs = 0;
```

Replace it with:

```typescript
let soundCloudPlaying = false;
let scMode: 'queue' | 'set' | null = null;
let scQueue: QueueTrack[] = [];
let scQueueIndex = -1;
let scSetTracks: TrackInfo[] = [];
let scSetIndex = -1;
let currentTrackDurationMs = 0;
```

- [ ] **Step 2: Add the `isSetUrl` helper**

Find the existing `titleFromUrl` function:

```typescript
function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const slug = path.split('/').pop() || url;
    return decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim() || url;
  } catch {
    return url;
  }
}
```

Add this right after it:

```typescript
/** Both soundcloud.com/user/sets/name and soundcloud.com/discover/sets/... match. */
function isSetUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes('/sets/');
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Replace `resetSoundCloudQueue` with `resetSoundCloudSession`**

Find:

```typescript
function resetSoundCloudQueue(): void {
  scQueue = [];
  scQueueIndex = -1;
}
```

Replace with:

```typescript
function resetSoundCloudSession(): void {
  scMode = null;
  scQueue = [];
  scQueueIndex = -1;
  scSetTracks = [];
  scSetIndex = -1;
}
```

- [ ] **Step 4: Update `startVisualizing` to use the renamed reset function**

Find:

```typescript
async function startVisualizing(): Promise<void> {
  soundCloudPlayer.dispose();
  hideNowPlaying();
  resetSoundCloudQueue();
  setPlayButtonMode('play');
  await capture.start();
  onCaptureReady();
}
```

Replace with:

```typescript
async function startVisualizing(): Promise<void> {
  soundCloudPlayer.dispose();
  hideNowPlaying();
  resetSoundCloudSession();
  setPlayButtonMode('play');
  await capture.start();
  onCaptureReady();
}
```

- [ ] **Step 5: Replace `updateQueueUI` with a mode-aware `updateSoundCloudUI`**

Find:

```typescript
function updateQueueUI(): void {
  setQueueCounter(scQueueIndex + 1, scQueue.length);
  setQueueNavEnabled(scQueueIndex > 0, scQueueIndex < scQueue.length - 1);
  renderPlaylist(
    scQueue.map((track) => ({ label: track.title ?? titleFromUrl(track.url) })),
    scQueueIndex,
    jumpToQueueTrack
  );
}
```

Replace with:

```typescript
function updateSoundCloudUI(): void {
  if (scMode === 'set') {
    setQueueCounter(scSetIndex + 1, scSetTracks.length);
    setQueueNavEnabled(scSetIndex > 0, scSetIndex < scSetTracks.length - 1);
    renderPlaylist(
      scSetTracks.map((track) => ({ label: track.title })),
      scSetIndex,
      jumpToSetTrack
    );
  } else if (scMode === 'queue') {
    setQueueCounter(scQueueIndex + 1, scQueue.length);
    setQueueNavEnabled(scQueueIndex > 0, scQueueIndex < scQueue.length - 1);
    renderPlaylist(
      scQueue.map((track) => ({ label: track.title ?? titleFromUrl(track.url) })),
      scQueueIndex,
      jumpToQueueTrack
    );
  } else {
    setQueueCounter(0, 0);
    setQueueNavEnabled(false, false);
    renderPlaylist([], -1, () => {});
  }
}
```

- [ ] **Step 6: Update every other reference to `updateQueueUI`**

There are three remaining call sites. Update each:

In `jumpToQueueTrack` — no change needed here, it calls `loadQueueTrack` which is handled in the next step.

In `loadQueueTrack`, find:

```typescript
  soundCloudPlaying = true;
  showNowPlaying(info);
  updateQueueUI();
}
```

Replace with:

```typescript
  soundCloudPlaying = true;
  showNowPlaying(info);
  updateSoundCloudUI();
}
```

In `startFromSoundCloud`, find:

```typescript
    scQueue.push({ url });
    updateQueueUI();
    showToast('Added to queue.');
```

Replace with:

```typescript
    scQueue.push({ url });
    updateSoundCloudUI();
    showToast('Added to queue.');
```

In `goHome`, find:

```typescript
  resetSoundCloudQueue();
  updateQueueUI();
```

Replace with:

```typescript
  resetSoundCloudSession();
  updateSoundCloudUI();
```

- [ ] **Step 7: Add `jumpToSetTrack`, `bindSetTrackChangeHandlers`, `startSet`, and `startQueueFresh`**

Find `jumpToQueueTrack`:

```typescript
function jumpToQueueTrack(index: number): void {
  if (index === scQueueIndex) return;
  loadQueueTrack(index).catch((err) => {
    showToast(err instanceof Error ? err.message : String(err));
  });
}
```

Add this right after it:

```typescript
function jumpToSetTrack(index: number): void {
  if (index === scSetIndex) return;
  soundCloudPlayer.skipTo(index);
}

/**
 * Binds the handlers that keep the UI in sync with a Set's internal
 * playback — must be (re)bound after every loadSet() call, since a fresh
 * widget instance is created each time. onTrackChange is what fixes the bug
 * where the title froze while SoundCloud auto-advanced through a Set.
 */
function bindSetTrackChangeHandlers(): void {
  // Deliberately no onFinish binding here (unlike loadQueueTrack): onFinish
  // exists to trigger *our* manual advance-to-next-queue-item logic, which
  // doesn't apply in Set mode — the widget advances through the Set on its
  // own, and onTrackChange (below) is what picks up each resulting track
  // change.
  soundCloudPlayer.onPlayStateChange(handleSoundCloudPlayStateChange);
  soundCloudPlayer.onTrackChange((info, index) => {
    scSetIndex = index;
    currentTrackDurationMs = info.durationMs;
    showNowPlaying(info);
    updateSoundCloudUI();
  });
  soundCloudPlayer.onProgress((progress) => {
    setProgress(progress.relativePosition, progress.currentPositionMs, currentTrackDurationMs);
  });
}

async function startQueueFresh(url: string): Promise<void> {
  scMode = 'queue';
  scQueue = [{ url }];
  await loadQueueTrack(0);
}

async function startSet(url: string): Promise<void> {
  const { tracks, initialIndex } = await soundCloudPlayer.loadSet(url);
  scMode = 'set';
  scSetTracks = tracks;
  scSetIndex = initialIndex;
  bindSetTrackChangeHandlers();
  soundCloudPlayer.play();
  soundCloudPlaying = true;
  // Shows immediately from the Set's track list; onTrackChange corrects
  // durationMs (0 here, a placeholder — see loadSet's doc comment) once the
  // first PLAY event fires.
  showNowPlaying(tracks[initialIndex]);
  updateSoundCloudUI();
}
```

- [ ] **Step 8: Rewrite `startFromSoundCloud`**

Find:

```typescript
async function startFromSoundCloud(url: string): Promise<void> {
  if (scQueue.length > 0) {
    // Already playing from SoundCloud — queue it instead of restarting capture.
    scQueue.push({ url });
    updateSoundCloudUI();
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
    resetSoundCloudSession();
    throw err;
  }
}
```

Replace with:

```typescript
async function startFromSoundCloud(url: string): Promise<void> {
  if (scMode === 'queue' && scQueue.length > 0) {
    // Already playing a queue — add to it instead of restarting capture.
    scQueue.push({ url });
    updateSoundCloudUI();
    showToast('Added to queue.');
    return;
  }

  // A Set can't be appended to (SoundCloud's widget has no such method) —
  // any new paste while one's active replaces it. If we're already
  // capturing (an active Set, or a plain Share-Audio session with no
  // SoundCloud track yet), reuse that capture instead of requesting a new
  // one — re-requesting would show another share picker unnecessarily.
  const alreadyCapturing = capture.isActive;
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
    resetSoundCloudSession();
    throw err;
  }

  setPlayButtonMode(scMode === 'queue' ? 'queue' : 'play');
  if (!alreadyCapturing) onCaptureReady();
}
```

- [ ] **Step 9: Add mode-aware `playNextTrack`/`playPrevTrack` and wire them in**

Find:

```typescript
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
```

Add right after it:

```typescript
function playNextTrack(): void {
  if (scMode === 'set') {
    if (scSetIndex < scSetTracks.length - 1) soundCloudPlayer.next();
  } else {
    playNextInQueue();
  }
}

function playPrevTrack(): void {
  if (scMode === 'set') {
    if (scSetIndex > 0) soundCloudPlayer.prev();
  } else {
    playPrevInQueue();
  }
}
```

Find the `setupSoundCloudPanel` call near the bottom of the file:

```typescript
setupSoundCloudPanel({
  onPlayRequested: startFromSoundCloud,
  onToggleClick: toggleSoundCloudPlayback,
  onPrevTrack: playPrevInQueue,
  onNextTrack: playNextInQueue,
  onVolumeChange: handleVolumeChange,
  onSeek: handleSeek,
});
```

Replace with:

```typescript
setupSoundCloudPanel({
  onPlayRequested: startFromSoundCloud,
  onToggleClick: toggleSoundCloudPlayback,
  onPrevTrack: playPrevTrack,
  onNextTrack: playNextTrack,
  onVolumeChange: handleVolumeChange,
  onSeek: handleSeek,
});
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `scMode`, `scSetTracks`, `scSetIndex`, or `TrackInfo` show up as unused-variable errors, double check every replace in Steps 1-9 was applied — a leftover reference to the old `updateQueueUI` name is the most likely cause.

- [ ] **Step 11: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 12: Manual test — Queue mode regression check**

Start the dev server (`npm run dev -- --port 5193`) and, using claude-in-chrome with the mocked `getDisplayMedia` pattern used throughout this project, paste `https://soundcloud.com/forss/flickermood` (a single track, not a Set) and confirm the existing Queue-mode flow still works exactly as before: title/artwork appear, adding a second individual track shows "Added to queue.", prev/next/click-to-jump work, progress bar advances.

- [ ] **Step 13: Manual test — Set mode, the actual bug this fixes**

With the same dev server running, paste `https://soundcloud.com/soundcloud/sets/creator-radio` from a fresh session (Home first if a queue is active). Confirm:
- The playlist sidebar populates with the Set's real tracklist (from `getSounds()`), not a single entry
- The Now Playing title shows the first track immediately
- Click a different row in the playlist — confirm it jumps to that track (via `skipTo`) and the title updates
- Click the transport bar's next/prev buttons — confirm they call the widget's native navigation and the title updates correctly (this is the direct regression test for the reported bug: previously the title stayed frozen)
- Let a track play to completion (or seek near the end via the progress bar) and confirm the widget auto-advances to the next track **and the title updates** — the original bug was exactly this case silently failing
- Check the browser console for errors throughout

- [ ] **Step 14: Manual test — replacing an active Set**

While the Set from Step 13 is still playing, paste a different individual track URL (e.g. `https://soundcloud.com/forss/flickermood`) into the sidebar's add form. Confirm:
- No new tab-share picker is requested (capture continues uninterrupted — check `capture.isActive` stayed true throughout, or simply confirm visually that audio doesn't glitch/reset)
- Playback replaces the Set with the new single track, dropping into Queue mode
- The playlist sidebar now shows just that one track

- [ ] **Step 15: Stop the dev server and clean up build artifacts**

```bash
rm -rf dist
```

- [ ] **Step 16: Commit**

```bash
git add src/main.ts
git commit -m "Wire SoundCloud Set mode into main.ts"
```

---

## Explicitly Out of Scope

- Pushing to GitHub / opening a PR — user asked to hold off; stop after Task 3's commit.
- Per-track duration display in the playlist sidebar rows (the mockup showed it, but `PlaylistEntry` only carries `label` today and `getSounds()` doesn't return duration — adding it would need a `getDuration()` call per track up front, which isn't needed to fix the reported bug).
- Any UI/styling changes — none are needed; every element this feature touches already exists and is generic enough to serve both modes.
