/**
 * Feature check for Butterchurn support, mirroring the logic in its own
 * `butterchurn/lib/isSupported.min.js` (WebGL2 + an AudioContext). We
 * reimplement it locally rather than importing that sub-path: it's an old
 * webpack/UMD bundle whose nested `module.exports.default` doesn't survive
 * Vite's CJS→ESM interop as a plain function import, and this check is
 * small enough that duplicating it is safer than fighting that interop.
 */
export function isButterchurnSupported(): boolean {
  let hasWebgl2 = false;
  try {
    const canvas = document.createElement('canvas');
    hasWebgl2 = !!canvas.getContext('webgl2');
  } catch {
    hasWebgl2 = false;
  }
  const hasAudioContext = 'AudioContext' in window || 'webkitAudioContext' in window;
  return hasWebgl2 && hasAudioContext;
}
