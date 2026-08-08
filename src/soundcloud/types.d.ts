/**
 * SoundCloud's Widget API has no npm package — it's loaded at runtime via a
 * <script> tag (see src/soundcloud/widget.ts) and exposes a global `SC`.
 * These ambient declarations cover only the surface this project uses — see
 * https://developers.soundcloud.com/docs/api/html5-widget for the full API.
 */
interface SCWidgetSound {
  title: string;
  artwork_url: string | null;
  user?: { username?: string };
}

interface SCWidgetProgressData {
  /** 0-1. */
  relativePosition: number;
  /** Milliseconds. */
  currentPosition: number;
  /** 0-1. */
  loadProgress: number;
}

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
}

interface SCWidgetEvents {
  READY: string;
  ERROR: string;
  PLAY: string;
  PAUSE: string;
  FINISH: string;
  PLAY_PROGRESS: string;
}

interface SCWidgetStatic {
  (iframe: HTMLIFrameElement): SCWidget;
  Events: SCWidgetEvents;
}

interface Window {
  SC?: { Widget: SCWidgetStatic };
}
