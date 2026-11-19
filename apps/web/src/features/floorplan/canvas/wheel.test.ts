import { describe, expect, it } from 'vitest';
import { wheelIntent, type WheelInput } from './wheel';

const wheel = (input: Partial<WheelInput>): WheelInput => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...input,
});

describe('wheelIntent', () => {
  it('zooms for a trackpad pinch and for Ctrl/Cmd + wheel', () => {
    expect(wheelIntent(wheel({ deltaY: 2.5, ctrlKey: true }))).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: 100, metaKey: true }))).toBe('zoom');
  });

  it('zooms for mouse notches: line or page deltas, or large whole pixel steps', () => {
    expect(wheelIntent(wheel({ deltaY: 3, deltaMode: 1 }))).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: 1, deltaMode: 2 }))).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: 100 }))).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: -120 }))).toBe('zoom');
  });

  it('pans for trackpad scrolling: small, fractional or two-axis pixel deltas, and with Shift', () => {
    expect(wheelIntent(wheel({ deltaY: 4 }))).toBe('pan');
    expect(wheelIntent(wheel({ deltaY: 66.5 }))).toBe('pan');
    expect(wheelIntent(wheel({ deltaX: 3, deltaY: 100 }))).toBe('pan');
    expect(wheelIntent(wheel({ deltaY: 100, shiftKey: true }))).toBe('pan');
  });
});
