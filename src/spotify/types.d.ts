/**
 * Spotify's Web Playback SDK has no npm package — it's loaded at runtime via
 * a <script> tag (see src/spotify/player.ts) and exposes a global `Spotify`
 * namespace once ready. These ambient declarations cover only the surface
 * this project uses — see
 * https://developer.spotify.com/documentation/web-playback-sdk for the full
 * API. No `export` statements here (matches src/soundcloud/types.d.ts) so
 * this stays a global ambient script and its `Window` augmentation merges
 * with soundcloud/types.d.ts's own `Window.SC` augmentation.
 */
interface SpotifyPlayerTrack {
  uri: string;
  name: string;
  duration_ms: number;
  album: {
    images: { url: string }[];
  };
}

interface SpotifyPlaybackState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: SpotifyPlayerTrack;
  };
}

interface SpotifyPlayerErrorEvent {
  message: string;
}

interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: 'ready' | 'not_ready', cb: (data: { device_id: string }) => void): void;
  addListener(event: 'player_state_changed', cb: (state: SpotifyPlaybackState | null) => void): void;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (data: SpotifyPlayerErrorEvent) => void
  ): void;
  getCurrentState(): Promise<SpotifyPlaybackState | null>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
}

interface SpotifyPlayerConstructorOptions {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume?: number;
}

interface SpotifyStatic {
  Player: new (options: SpotifyPlayerConstructorOptions) => SpotifyPlayerInstance;
}

interface Window {
  Spotify?: SpotifyStatic;
  onSpotifyWebPlaybackSDKReady?: () => void;
}
