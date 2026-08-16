/**
 * A minimal static file server for the packaged Electron app. It exists
 * for one reason: Spotify's OAuth PKCE flow (src/spotify/auth.ts) is
 * hardcoded to redirect back to http://127.0.0.1:5173/, the address
 * registered in the Spotify Developer Dashboard. Serving the built app
 * from that exact origin — instead of Electron's default file:// — means
 * the whole login flow works completely unchanged from how it runs in
 * dev/the browser.
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

/** Must match REDIRECT_URI's port in src/spotify/auth.ts and vite.config.ts. */
export const SPOTIFY_REDIRECT_PORT = 5173;
const HOST = '127.0.0.1';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolves a request path to a file under `root`. Falls back to
 * `index.html` — both for unknown client-side routes (SPA navigation) and
 * for any path that would otherwise resolve outside `root` (traversal
 * attempts) — same fallback, since neither case has a real file to serve.
 */
export async function resolveStaticFile(root: string, requestPath: string): Promise<string> {
  const indexPath = join(root, 'index.html');
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, `.${decoded}`);

  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + sep)) {
    return indexPath;
  }

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    // No file there — fall through to the SPA fallback below.
  }
  return indexPath;
}

export interface StartedServer {
  server: Server;
  port: number;
  /** True only when bound to SPOTIFY_REDIRECT_PORT — the port Spotify's redirect URI requires. */
  matchesSpotifyRedirect: boolean;
}

/**
 * Starts the static server, preferring SPOTIFY_REDIRECT_PORT so Spotify
 * login works. Falls back to an OS-assigned port if that one's taken —
 * the app still starts, everything except Spotify login still works, and
 * callers can check `matchesSpotifyRedirect` to warn the user.
 */
export function startStaticServer(root: string): Promise<StartedServer> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const filePath = await resolveStaticFile(root, req.url ?? '/');
        const body = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypeFor(filePath) });
        res.end(body);
      } catch {
        res.writeHead(500);
        res.end('Internal error');
      }
    })();
  });

  function describeListening(): StartedServer {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : SPOTIFY_REDIRECT_PORT;
    return { server, port, matchesSpotifyRedirect: port === SPOTIFY_REDIRECT_PORT };
  }

  return new Promise((resolvePromise) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') throw err;
      server.removeAllListeners('listening');
      server.once('listening', () => resolvePromise(describeListening()));
      server.listen(0, HOST);
    });
    server.once('listening', () => resolvePromise(describeListening()));
    server.listen(SPOTIFY_REDIRECT_PORT, HOST);
  });
}
