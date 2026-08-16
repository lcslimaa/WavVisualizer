/**
 * Detects the Electron desktop shell from the renderer side. Electron adds
 * "Electron/x.y.z" to the user agent specifically so apps can branch on
 * this (see electron/main.ts's doc comments for what depends on it: Share
 * Audio's system-wide loopback capture, and Spotify links opening in the
 * native app instead of playing in-app — Electron doesn't support the DRM
 * the Web Playback SDK needs).
 */
export function isElectronRuntime(userAgent: string): boolean {
  return /\bElectron\//.test(userAgent);
}
