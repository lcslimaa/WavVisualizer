/**
 * Electron main process entry point. Its only real job is to serve the
 * built app from http://127.0.0.1:5173/ (see server.ts's doc comment for
 * why) and open a window pointed at it — everything else is standard
 * Electron boilerplate.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startStaticServer, SPOTIFY_REDIRECT_PORT } from './server.js';
import { supportsLoopbackAudio } from './displayMedia.js';

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

  // Spotify links (src/main.ts's openSpotifyInNativeApp) navigate to a
  // spotify: URI to hand playback off to the native app — Electron can't
  // navigate the window itself there, so route it to the OS instead.
  // will-navigate covers window.location.href; setWindowOpenHandler covers
  // window.open()/target="_blank"/middle-click.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('spotify:')) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('spotify:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(`http://127.0.0.1:${started.port}/`);
}

/**
 * Backs the renderer's navigator.mediaDevices.getDisplayMedia() calls
 * (src/audio/capture.ts) — Electron doesn't implement a browser-style
 * picker on its own, so without this, "Share Audio" would just fail.
 *
 * Video comes from the requesting window's own frame rather than
 * desktopCapturer.getSources() — capture.ts discards the video track
 * immediately anyway, and self-capturing our own window needs no OS
 * permission, unlike enumerating the desktop (full Screen Recording
 * access). That keeps this scoped to exactly what we use: audio.
 *
 * Deliberately NOT using { useSystemPicker: true }: on macOS it hands
 * the whole request to the OS's native picker, which is a confirmed
 * Electron bug (electron/electron#44685) that drops the audio track
 * regardless of the user's choice. Running our own handler every time
 * lets us request 'loopback' audio explicitly. See displayMedia.ts.
 */
function setUpDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.frame) {
      callback({});
      return;
    }
    callback({
      video: request.frame,
      ...(supportsLoopbackAudio(process.platform) ? { audio: 'loopback' as const } : {}),
    });
  });
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
