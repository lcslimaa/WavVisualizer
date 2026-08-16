/**
 * Decides how to answer Electron's session.setDisplayMediaRequestHandler
 * for a getDisplayMedia() request. This only runs as a fallback — on
 * macOS 15+ (this app's dev target), useSystemPicker: true makes Electron
 * show the OS's own picker instead, and this function never runs at all,
 * matching the browser's own getDisplayMedia picker (video + audio choice
 * baked into the OS UI). On platforms/OS versions without that native
 * picker, we have to choose a source ourselves with no UI of our own.
 *
 * src/audio/capture.ts needs no changes either way — it's the same Web
 * API call, intercepted transparently at the Electron session level.
 */

export interface DisplayMediaSource {
  id: string;
  name: string;
}

export interface DisplayMediaResponse {
  video: DisplayMediaSource;
  /** 'loopback' = true system-audio capture. Windows-only via this API. */
  audio?: 'loopback';
}

/**
 * `sources` should come from desktopCapturer.getSources(). Picks the
 * first one — this fallback path has no UI to let the user choose.
 * Returns null if none were found (e.g. an environment with no displays).
 */
export function buildDisplayMediaResponse(
  platform: NodeJS.Platform,
  sources: DisplayMediaSource[],
): DisplayMediaResponse | null {
  const [firstSource] = sources;
  if (!firstSource) return null;

  return {
    video: firstSource,
    // Only Windows exposes true system-audio loopback through this API;
    // macOS/Linux fall through with no audio field, and capture.ts's
    // existing "No audio was shared" error covers that gracefully.
    ...(platform === 'win32' ? { audio: 'loopback' as const } : {}),
  };
}
