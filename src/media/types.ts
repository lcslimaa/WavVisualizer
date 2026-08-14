/**
 * Shared playback types used by every media source (SoundCloud, Spotify).
 * Kept separate from src/soundcloud/widget.ts so a second provider doesn't
 * have to import SoundCloud-specific code just to get a shared shape.
 */
export interface TrackInfo {
  title: string;
  artworkUrl: string | null;
  durationMs: number;
}

export interface ProgressInfo {
  relativePosition: number;
  currentPositionMs: number;
}

/**
 * Common playback-control surface every provider's player class implements.
 * Deliberately excludes "load a URL" — SoundCloud's load()/loadSet() and
 * Spotify's loadTrack()/loadContext() differ enough in shape (single track
 * vs. playlist/album context, provider-specific URL parsing) that forcing a
 * shared load signature would add an abstraction with no real reuse.
 */
export interface MediaSource {
  play(): void;
  pause(): void;
  /** 0-100. */
  setVolume(volume: number): void;
  /** Jumps to a position in the current track (0-1 fraction of its duration). */
  seekTo(fraction: number, durationMs: number): void;
  /** Skips to the next track — only meaningful in 'set' mode (native playlist/Set navigation). */
  next(): void;
  /** Skips to the previous track — only meaningful in 'set' mode. */
  prev(): void;
  /** Jumps directly to the track at `index` (0-based) within the active playlist/Set. */
  skipTo(index: number): void;
  onPlayStateChange(cb: (playing: boolean) => void): void;
  onTrackChange(cb: (info: TrackInfo, index: number) => void): void;
  onProgress(cb: (info: ProgressInfo) => void): void;
  /** Fires when a single loaded track finishes — used for queue-mode auto-advance. */
  onFinish(cb: () => void): void;
  dispose(): void;
}
