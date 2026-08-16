import { describe, expect, test } from 'vitest';
import { isElectronRuntime } from './platform';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) WavVisualizer/0.0.0 Chrome/141.0.0.0 Electron/43.4.0 Safari/537.36';

describe('isElectronRuntime', () => {
  test('recognizes an Electron user agent', () => {
    expect(isElectronRuntime(ELECTRON_UA)).toBe(true);
  });

  test('does not flag a regular Chrome user agent', () => {
    expect(isElectronRuntime(CHROME_UA)).toBe(false);
  });

  test('does not flag an empty user agent', () => {
    expect(isElectronRuntime('')).toBe(false);
  });
});
