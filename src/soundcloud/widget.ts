/**
 * Thin wrapper around SoundCloud's Widget API. Nothing is extracted or
 * downloaded from SoundCloud here — we embed their official player and let
 * it play normally; visualizing it happens separately, by capturing this
 * tab's audio output (see src/audio/capture.ts), the same legitimate
 * mechanism already used for any other audio source in this app.
 */

const WIDGET_API_URL = 'https://w.soundcloud.com/player/api.js';
const READY_TIMEOUT_MS = 12000;

export interface TrackInfo {
  title: string;
  artworkUrl: string | null;
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
export class SoundCloudPlayer {
  private iframe: HTMLIFrameElement | null = null;
  private widget: SCWidget | null = null;
  // Persisted across tracks — each load() creates a brand new widget
  // instance, which would otherwise reset to 100 every time.
  private volume = 100;

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
          resolve({
            title: sound?.title ?? 'Unknown track',
            artworkUrl: sound?.artwork_url ?? null,
          });
        });
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

  private teardown(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.widget = null;
  }

  dispose(): void {
    this.teardown();
  }
}
