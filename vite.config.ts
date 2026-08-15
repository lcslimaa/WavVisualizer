import { defineConfig } from 'vite';

// Pinned so the Spotify OAuth Redirect URI registered in the Spotify
// Developer Dashboard (http://127.0.0.1:5173/) never silently drifts to a
// different port — Spotify requires an exact match, and rejects the string
// "localhost" outright (must be the loopback IP literal). Explicit `host`
// ensures Vite actually binds and prints that literal, not "localhost".
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
