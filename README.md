# WavVisualizer

A Windows Media Player–style audio visualizer that runs entirely in the browser — visualize whatever's playing on your system with built-in presets, or load MilkDrop/Butterchurn `.json` presets for the full classic experience.

## Features

- **Live system audio** — visualizes whatever's actually playing (a tab, a window, your whole screen), not just a file you upload.
- **3 built-in presets** — Bars (spectrum analyzer), Ambient Particles, and Kaleidoscope, all rendered on Canvas2D.
- **Butterchurn/MilkDrop preset support** — load any Butterchurn-format `.json` preset file and it renders through its own WebGL2 engine, right alongside the built-in presets.
- **No backend** — a static site (Vite + TypeScript), deployable anywhere that serves static files over HTTPS.

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
  main.ts         Wires it all together: render loop, preset switching
```

## How it works

A single shared `AnalyserNode` feeds frequency/waveform data to the Canvas2D presets each animation frame. Butterchurn presets are different — they own a WebGL2 context entirely and do their own internal audio analysis (bass/mid/treble, beat detection) once connected to a raw `AudioNode`, so they run through a separate engine (`src/butterchurn/engine.ts`) rather than the Canvas2D plugin interface (`src/visualizers/types.ts`). Both engines share one flat, cyclable preset list in the UI.

## Known limitations

- Browsers have no direct OS-level audio "loopback" API, so capture works via the screen/tab-share picker — it must be granted every session and can't start silently.
- If the shared source stops (e.g. you close the shared tab), visuals will freeze rather than auto-reconnect; click Share Audio again to resume.

## Building & deploying

```bash
npm run build    # outputs a static dist/
npm run preview  # sanity-check the production build locally
```

`dist/` can be deployed to any static host (GitHub Pages, Netlify, Vercel, etc.) — just make sure it's served over HTTPS.

## License

MIT — see [LICENSE](LICENSE).
