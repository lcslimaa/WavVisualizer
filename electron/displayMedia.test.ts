import { describe, expect, test } from 'vitest';
import { supportsLoopbackAudio } from './displayMedia';

describe('supportsLoopbackAudio', () => {
  test('Windows supports system-audio loopback (WASAPI)', () => {
    expect(supportsLoopbackAudio('win32')).toBe(true);
  });

  test('macOS supports system-audio loopback (CoreAudio Tap, macOS 13+)', () => {
    expect(supportsLoopbackAudio('darwin')).toBe(true);
  });

  test('Linux does not support system-audio loopback via this API', () => {
    expect(supportsLoopbackAudio('linux')).toBe(false);
  });
});
