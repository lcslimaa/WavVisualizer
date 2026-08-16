import { describe, expect, test, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { resolveStaticFile, mimeTypeFor, startStaticServer, SPOTIFY_REDIRECT_PORT } from './server';

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wavviz-static-'));
  await writeFile(join(root, 'index.html'), '<html>root</html>');
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
  return root;
}

describe('resolveStaticFile', () => {
  test('resolves an existing file under root', async () => {
    const root = await makeRoot();
    const result = await resolveStaticFile(root, '/assets/app.js');
    expect(result).toBe(join(root, 'assets', 'app.js'));
  });

  test('falls back to index.html for an unknown SPA route', async () => {
    const root = await makeRoot();
    const result = await resolveStaticFile(root, '/some/client/route');
    expect(result).toBe(join(root, 'index.html'));
  });

  test('ignores query strings when resolving a real file', async () => {
    const root = await makeRoot();
    const result = await resolveStaticFile(root, '/assets/app.js?code=abc&state=xyz');
    expect(result).toBe(join(root, 'assets', 'app.js'));
  });

  test('falls back to index.html instead of escaping root via path traversal', async () => {
    const root = await makeRoot();
    const result = await resolveStaticFile(root, '/../../../../etc/passwd');
    expect(result).toBe(join(root, 'index.html'));
  });
});

describe('mimeTypeFor', () => {
  test('maps .js to a JavaScript content type', () => {
    expect(mimeTypeFor('/assets/app.js')).toBe('text/javascript; charset=utf-8');
  });

  test('maps .html to an HTML content type', () => {
    expect(mimeTypeFor('/index.html')).toBe('text/html; charset=utf-8');
  });

  test('falls back to application/octet-stream for unknown extensions', () => {
    expect(mimeTypeFor('/assets/preset.milk')).toBe('application/octet-stream');
  });
});

describe('startStaticServer', () => {
  let cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.map((fn) => fn()));
    cleanup = [];
  });

  test('binds to the Spotify-registered port when it is free', async () => {
    const root = await makeRoot();
    const started = await startStaticServer(root);
    cleanup.push(() => new Promise((resolve) => started.server.close(() => resolve())));

    expect(started.port).toBe(SPOTIFY_REDIRECT_PORT);
    expect(started.matchesSpotifyRedirect).toBe(true);
  });

  test('falls back to another port when the Spotify-registered port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(SPOTIFY_REDIRECT_PORT, '127.0.0.1', resolve));
    cleanup.push(() => new Promise((resolve) => blocker.close(() => resolve())));

    const root = await makeRoot();
    const started = await startStaticServer(root);
    cleanup.push(() => new Promise((resolve) => started.server.close(() => resolve())));

    expect(started.port).not.toBe(SPOTIFY_REDIRECT_PORT);
    expect(started.matchesSpotifyRedirect).toBe(false);
  });

  test('serves index.html over HTTP for a request with no matching file', async () => {
    const root = await makeRoot();
    const started = await startStaticServer(root);
    cleanup.push(() => new Promise((resolve) => started.server.close(() => resolve())));

    const res = await fetch(`http://127.0.0.1:${started.port}/?code=abc&state=xyz`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toBe('<html>root</html>');
  });
});
