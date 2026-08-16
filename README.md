# WavVisualizer

A Windows Media Player–style audio visualizer — visualize whatever's playing on your system with built-in presets, or load MilkDrop/Butterchurn `.json` presets for the full classic experience. Runs as a browser app or as a desktop app (Electron) — see [Desktop app](#desktop-app-electron) below.

## Features

- **Live system audio** — visualizes whatever's actually playing (a tab, a window, your whole screen in the browser; true system-wide loopback in the desktop app), not just a file you upload.
- **3 built-in presets** — Bars (spectrum analyzer), Ambient Particles, and Kaleidoscope, all rendered on Canvas2D.
- **Butterchurn/MilkDrop preset support** — load any Butterchurn-format `.json` preset file and it renders through its own WebGL2 engine, right alongside the built-in presets.
- **No backend** — a static site (Vite + TypeScript), deployable anywhere that serves static files over HTTPS. The desktop app packages that same site with Electron.

## Browser requirements

- **Chrome or Edge recommended.** Sharing system/tab *audio* (not just video) via the browser's screen-share picker is reliable in Chromium browsers; Firefox and Safari support is inconsistent or missing.
- **WebGL2** is required for Butterchurn presets. If it's unavailable, the app still works — the "load preset" button just disables itself with an explanation.
- **HTTPS or localhost** — `getDisplayMedia` (the API used to capture audio) is blocked on plain HTTP.

## Getting started

```bash
git clone git@github.com:lcslimaa/WavVisualizer.git
cd WavVisualizer
npm install
npm run dev
```

Open the printed `localhost` URL in Chrome or Edge.

## Spotify setup (optional, browser build only)

This setup is only needed for the browser build's in-app Spotify playback. The desktop app doesn't use it at all — see [Desktop app](#desktop-app-electron).

SoundCloud links work with no setup. Spotify links need a one-time setup, because Spotify requires every app to register its own credentials:

1. Create a free app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add Redirect URI `http://127.0.0.1:5173/` exactly (the loopback IP literal — Spotify rejects the string `localhost`).
3. Copy `.env.example` to `.env` and paste in your app's Client ID:
   ```bash
   cp .env.example .env
   ```
4. `npm run dev` — the dev server is pinned to port 5173 to match the registered Redirect URI.

Two real limitations, both enforced by Spotify and not fixable in this app:
- **Playback requires Spotify Premium** — Free accounts get a clear error when trying to play.
- **Playlists**: while the app is in Spotify's "Development Mode" (the default until you apply for extended access), only playlists you own or collaborate on are accessible — playlists you merely follow (including Spotify's own editorial playlists) fail with a permissions error. Tracks and albums aren't affected.

## Usage

- Click **Share Audio**, then pick a tab, window, or screen — make sure **"Share audio"** is checked in the picker.
- Cycle presets with the ← / → HUD buttons or arrow keys.
- Press **F** or the HUD button to toggle fullscreen.
- Click **📁** to load one or more Butterchurn/MilkDrop `.json` preset files — they get appended to the preset cycle.
- Click **🔀** to auto-cycle randomly through your loaded Butterchurn presets (needs at least 2 loaded); set the interval in seconds next to it. Manually stepping presets resets the countdown; going Home turns it off.

## Project structure

```
src/
  audio/         Audio capture pipeline (getDisplayMedia → AnalyserNode)
  visualizers/    Canvas2D preset engine + the 3 built-in presets
  butterchurn/    Butterchurn (WebGL2/MilkDrop) engine wrapper + support checks
  ui/             HUD controls, preset file loader, toast notifications
  platform.ts     Detects the Electron runtime (gates desktop-only behavior)
  main.ts         Wires it all together: render loop, preset switching
electron/         Desktop app shell (main process) — see Desktop app below
```

## How it works

A single shared `AnalyserNode` feeds frequency/waveform data to the Canvas2D presets each animation frame. Butterchurn presets are different — they own a WebGL2 context entirely and do their own internal audio analysis (bass/mid/treble, beat detection) once connected to a raw `AudioNode`, so they run through a separate engine (`src/butterchurn/engine.ts`) rather than the Canvas2D plugin interface (`src/visualizers/types.ts`). Both engines share one flat, cyclable preset list in the UI.

## Known limitations

- **Browser build:** no direct OS-level audio "loopback" API, so capture works via the screen/tab-share picker — it must be granted every session and can't start silently. (The desktop app doesn't have this limitation — see below.)
- If the shared source stops (e.g. you close the shared tab), visuals will freeze rather than auto-reconnect; click Share Audio again to resume.
- **Desktop build, Spotify:** no in-app playback — Electron doesn't support the DRM (Widevine) the Spotify Web Playback SDK requires, so Spotify links open in your native Spotify app instead (see below). No in-app progress bar/controls for it.

## Building & deploying

```bash
npm run build    # outputs a static dist/
npm run preview  # sanity-check the production build locally
```

`dist/` can be deployed to any static host (GitHub Pages, Netlify, Vercel, etc.) — just make sure it's served over HTTPS.

## Desktop app (Electron)

The same app, packaged with Electron instead of running in a browser tab. It gets one real upgrade over the browser build — true system-wide audio loopback (`audio: 'loopback'`, Chromium's CoreAudio Tap API on macOS 13+ / WASAPI on Windows) — so Share Audio captures everything playing on your system with no per-session picker, and no scoping to a single tab/window.

```bash
npm run electron       # build + launch in dev
npm run electron:dist  # build a packaged app (electron-builder) into release/
```

**Spotify works differently here:** since Electron can't support the Web Playback SDK's DRM requirement, Spotify links open in your installed Spotify app instead of playing in-app — it plays there, and the desktop app's system-audio loopback visualizes it like any other source. This needs no setup (skips the [Spotify OAuth setup](#spotify-setup-optional-browser-build-only) above entirely) but does need the Spotify app installed. SoundCloud still plays in-app, same as the browser build.

**macOS:** the first `npm run electron:dist` build is unsigned (no Apple Developer ID configured), so:
- Gatekeeper will block the first launch — right-click → Open, or run `xattr -cr "release/mac-arm64/WavVisualizer.app"` first.
- Audio capture needs macOS to recognize the app via a stable code signature; if Share Audio fails silently, ad-hoc sign it once: `codesign --force --deep --sign - "release/mac-arm64/WavVisualizer.app"`, then grant it under System Settings → Privacy & Security when prompted.
- Distributing the app to other people would need a real Apple Developer ID (Team ID) — ad-hoc signing is fine for local use only.

## License

MIT — see [LICENSE](LICENSE).
