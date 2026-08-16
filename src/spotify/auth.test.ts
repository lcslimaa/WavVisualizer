import { describe, expect, test } from 'vitest';
import { originMatchesRedirectUri } from './auth';

describe('originMatchesRedirectUri', () => {
  test('matches the exact origin Spotify has registered', () => {
    expect(originMatchesRedirectUri('http://127.0.0.1:5173')).toBe(true);
  });

  test('rejects a different port (e.g. a fallback port used when 5173 was taken)', () => {
    expect(originMatchesRedirectUri('http://127.0.0.1:54213')).toBe(false);
  });

  test('rejects "localhost" even though it points at the same machine', () => {
    expect(originMatchesRedirectUri('http://localhost:5173')).toBe(false);
  });
});
