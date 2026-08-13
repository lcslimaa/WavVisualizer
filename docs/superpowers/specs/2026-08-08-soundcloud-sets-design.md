# SoundCloud Set (playlist) support

## Context

WavVisualizer currently supports pasting individual SoundCloud track links, which get added one at a time to an app-managed queue (`scQueue` in `src/main.ts`). The user asked whether SoundCloud "Sets" (playlists, e.g. `https://soundcloud.com/discover/sets/trending-by-genre:disco`) could be supported too.

Research confirmed SoundCloud's Widget API accepts a Set URL through the exact same embed mechanism as a single track (SoundCloud's own docs describe embedding "a track or playlist" via the same `url=` parameter), and the resulting widget becomes what they call a "multi-sound widget" with its own `getSounds()` / `skip(index)` / `next()` / `prev()` methods.

This was confirmed live during design: pasting a Set URL into the *current* (pre-this-feature) app already causes SoundCloud's widget to play through the set's tracks on its own — but the app's UI never notices, because nothing calls `getCurrentSound()`/`showNowPlaying()` again after the first track. The title freezes on track 1 while audio silently advances underneath it. This is the concrete bug this feature fixes, not just a nice-to-have.

## Decision

Add a second playback mode — **Set mode**, using SoundCloud's native multi-track widget — alongside the existing **Queue mode** (app-managed list of individually pasted tracks). Only one mode is active per session.

**Why not expand a Set into individual queue entries instead?** SoundCloud's Widget API has no method to append a track into an already-loaded multi-sound widget — `next()`/`prev()`/`skip()` only navigate within whatever was loaded via the original `url=`. Reusing the widget's own native playlist engine is both less code and the only approach that doesn't fight the API.

**Consequence:** pasting any new SoundCloud URL while a Set is active tears the Set down and starts fresh based on what the new URL is (a track starts Queue mode, another Set starts a new Set) — there's no "append to the currently playing Set" concept, matching the API's actual capabilities.

## Design

### Detecting a Set URL
Any pasted URL with `/sets/` in its path routes to Set mode instead of Queue mode. Covers both `soundcloud.com/user/sets/name` and `soundcloud.com/discover/sets/...`.

### `SoundCloudPlayer` (`src/soundcloud/widget.ts`) additions
- `loadSet(url): Promise<{ tracks: TrackInfo[]; initialIndex: number }>` — same widget-loading mechanism as today's `load()`, but on `READY` calls `getSounds()` to enumerate every track in the set (mapped to the existing `TrackInfo` shape) instead of just `getCurrentSound()`.
- `next()` / `prev()` / `skipTo(index)` — thin wrappers over the widget's native `next()`/`prev()`/`skip()`, used only in Set mode.
- Existing `onPlayStateChange` / `onFinish` / `onProgress` need no changes — same widget instance either way.
- **To verify empirically, not assumed:** whether track metadata (title/artwork) updates automatically after a native `next()`/`prev()`/auto-advance, or needs an explicit fresh `getCurrentSound()` call bound to a track-change signal. This is precisely the bug already observed, so it needs a real fix, not a guess.

### `main.ts` state
- New `scMode: 'queue' | 'set' | null`, replacing the current implicit "queue.length > 0" check.
- New `scSetTracks: TrackInfo[]` and `scSetIndex`, parallel to the existing `scQueue`/`scQueueIndex`.
- `startFromSoundCloud(url)` branches on `isSetUrl(url)`: Set path calls `loadSet()` and switches to Set mode; otherwise the existing Queue-mode logic runs unchanged.
- The playlist sidebar (`renderPlaylist`), prev/next buttons, progress bar, and click-to-jump are all reused as-is for both modes — just fed from whichever mode's state is active, and prev/next/click-to-jump call the widget's native navigation in Set mode instead of `loadQueueTrack()`.

### Error handling
- If `getSounds()` returns an empty list, or the URL doesn't resolve to a real embeddable Set, surface the existing toast-based error pattern (same as today's "This track can't be played" case).
- `soundcloud.com/soundcloud/sets/creator-radio` (an official SoundCloud set) is confirmed as a good, reliable test case.

### Testing
Live-tested in Chrome (same approach as prior SoundCloud work): load `soundcloud/sets/creator-radio`, confirm the sidebar populates from `getSounds()`, confirm native prev/next/click-to-jump work, and specifically confirm the title/artwork/progress bar correctly update as the widget auto-advances between tracks within the set — the exact case that's currently broken.
