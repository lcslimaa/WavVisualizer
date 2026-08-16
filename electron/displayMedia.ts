/**
 * Decides how to answer Electron's session.setDisplayMediaRequestHandler
 * for a getDisplayMedia() request.
 *
 * Video comes from the requesting page's own frame (request.frame in
 * main.ts) rather than desktopCapturer.getSources() — capture.ts throws
 * the video track away immediately anyway, and self-capturing our own
 * window needs no OS permission at all, unlike enumerating the desktop
 * (which needs full Screen Recording access). That keeps the permission
 * surface down to exactly what we actually use: system audio.
 *
 * We also don't delegate to Electron's native macOS picker
 * (useSystemPicker) — that path is a confirmed Electron bug
 * (electron/electron#44685, closed "not planned"): it drops the audio
 * track even when the user checks "Share audio" in the OS's own dialog.
 * Requesting 'loopback' explicitly here instead captures real
 * system-wide audio via Chromium's CoreAudio Tap API (Electron's default
 * since v39, macOS 13+ — also Windows via WASAPI).
 *
 * src/audio/capture.ts needs no changes either way — it's the same Web
 * API call, intercepted transparently at the Electron session level.
 */

const LOOPBACK_AUDIO_PLATFORMS: NodeJS.Platform[] = ['win32', 'darwin'];

/** True system-audio loopback via this API: Windows (WASAPI) and macOS 13+ (CoreAudio Tap). Not Linux. */
export function supportsLoopbackAudio(platform: NodeJS.Platform): boolean {
  return LOOPBACK_AUDIO_PLATFORMS.includes(platform);
}
