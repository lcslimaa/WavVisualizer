/**
 * Thin wrapper around SoundCloud's Widget API. Nothing is extracted or
 * downloaded from SoundCloud here — we embed their official player and let
 * it play normally; visualizing it happens separately, by capturing this
 * tab's audio output (see src/audio/capture.ts), the same legitimate
 * mechanism already used for any other audio source in this app.
 */

import type { TrackInfo, ProgressInfo, MediaSource } from '../media/types';

export type { TrackInfo, ProgressInfo };

const WIDGET_API_URL = 'https://w.soundcloud.com/player/api.js';
const READY_TIMEOUT_MS = 12000;

export interface SetInfo {
  tracks: TrackInfo[];
  initialIndex: number;
}

let apiLoadPromise: Promise<void> | null = null;

function loadWidgetApi(): Promise<void> {
  if (window.SC?.Widget) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = WIDGET_API_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the SoundCloud player."));
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

/** Manages a single (reused) hidden SoundCloud embed for in-app playback. */
export class SoundCloudPlayer implements MediaSource {
  private iframe: HTMLIFrameElement | null = null;
  private widget: SCWidget | null = null;
  // Persisted across tracks — each load() creates a brand new widget
  // instance, which would otherwise reset to 100 every time.
  private volume = 100;

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

  /**
   * Set-mode only: re-fetches every track's title/artwork from the widget's
   * sound list. SoundCloud's multi-sound widget doesn't have all of a large
   * Set's metadata resolved the instant it becomes READY — calling
   * getSounds() again a little later often fills in entries that first came
   * back as "Unknown track". Returns `[]` if there's no active widget (e.g.
   * the session has since moved on).
   */
  async refreshSounds(): Promise<TrackInfo[]> {
    const widget = this.widget;
    if (!widget) return [];
    return new Promise((resolve) => {
      widget.getSounds((sounds) => {
        resolve(
          (sounds ?? []).map((sound) => ({
            title: sound?.title ?? 'Unknown track',
            artworkUrl: sound?.artwork_url ?? null,
            durationMs: 0,
          }))
        );
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

  play(): void {
    this.widget?.play();
  }

  pause(): void {
    this.widget?.pause();
  }

  /** 0-100. Applied immediately and remembered for the next queued track. */
  setVolume(volume: number): void {
    this.volume = volume;
    this.widget?.setVolume(volume);
  }

  /** Fires whenever playback starts/stops (user controls in SoundCloud's own UI, manual pause/play). */
  onPlayStateChange(cb: (playing: boolean) => void): void {
    const SC = window.SC;
    if (!this.widget || !SC) return;
    this.widget.bind(SC.Widget.Events.PLAY, () => cb(true));
    this.widget.bind(SC.Widget.Events.PAUSE, () => cb(false));
  }

  /** Fires when the current track finishes playing (for queue auto-advance). */
  onFinish(cb: () => void): void {
    const SC = window.SC;
    if (!this.widget || !SC) return;
    this.widget.bind(SC.Widget.Events.FINISH, () => cb());
  }

  /** Fires periodically during playback with the current position — drives the progress bar. */
  onProgress(cb: (info: ProgressInfo) => void): void {
    const SC = window.SC;
    if (!this.widget || !SC) return;
    this.widget.bind(SC.Widget.Events.PLAY_PROGRESS, (data) => {
      const progress = data as SCWidgetProgressData | undefined;
      if (!progress) return;
      cb({ relativePosition: progress.relativePosition, currentPositionMs: progress.currentPosition });
    });
  }

  /** Jumps to a position in the current track (0-1 fraction of its duration). */
  seekTo(fraction: number, durationMs: number): void {
    this.widget?.seekTo(Math.max(0, Math.min(1, fraction)) * durationMs);
  }

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

  private teardown(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.widget = null;
  }

  dispose(): void {
    this.teardown();
  }
}
