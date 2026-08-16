import { describe, expect, test } from 'vitest';
import { buildDisplayMediaResponse } from './displayMedia';

const screen = { id: 'screen:0:0', name: 'Entire screen' };
const windowSource = { id: 'window:123:0', name: 'Some App' };

describe('buildDisplayMediaResponse', () => {
  test('on Windows, requests the first source with system-audio loopback', () => {
    const result = buildDisplayMediaResponse('win32', [screen, windowSource]);
    expect(result).toEqual({ video: screen, audio: 'loopback' });
  });

  test('on macOS, requests the first source with no audio field (loopback is Windows-only via this API)', () => {
    const result = buildDisplayMediaResponse('darwin', [screen, windowSource]);
    expect(result).toEqual({ video: screen });
  });

  test('on Linux, requests the first source with no audio field', () => {
    const result = buildDisplayMediaResponse('linux', [screen, windowSource]);
    expect(result).toEqual({ video: screen });
  });

  test('returns null when no sources are available at all', () => {
    const result = buildDisplayMediaResponse('darwin', []);
    expect(result).toBeNull();
  });
});
