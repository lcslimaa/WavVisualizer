/**
 * Electron main process entry point. Its only real job is to serve the
 * built app from http://127.0.0.1:5173/ (see server.ts's doc comment for
 * why) and open a window pointed at it — everything else is standard
 * Electron boilerplate.
 */
import { app, BrowserWindow, desktopCapturer, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startStaticServer, SPOTIFY_REDIRECT_PORT } from './server.js';
import { buildDisplayMediaResponse } from './displayMedia.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Compiled to dist-electron/main.js; the built renderer (`npm run build`) lands in dist/ next to it.
const RENDERER_ROOT = join(__dirname, '..', 'dist');

async function createWindow(): Promise<void> {
  const started = await startStaticServer(RENDERER_ROOT);
  if (!started.matchesSpotifyRedirect) {
    console.warn(
      `[WavVisualizer] Port ${SPOTIFY_REDIRECT_PORT} was already in use — serving on ${started.port} instead. ` +
        'Spotify login will be unavailable this session (see src/spotify/auth.ts\'s originMatchesRedirectUri guard).',
    );
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await win.loadURL(`http://127.0.0.1:${started.port}/`);
}

/**
 * Backs the renderer's navigator.mediaDevices.getDisplayMedia() calls
 * (src/audio/capture.ts) — Electron doesn't implement a browser-style
 * picker on its own, so without this, "Share Audio" would just fail.
 * useSystemPicker hands the whole request to the OS's native picker on
 * macOS 15+, where this handler function isn't even invoked; it only
 * runs as a fallback elsewhere. See electron/displayMedia.ts.
 */
function setUpDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const response = buildDisplayMediaResponse(process.platform, sources);
      callback(response ?? {});
    });
  }, { useSystemPicker: true });
}

app.whenReady().then(() => {
  setUpDisplayMediaHandler();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
