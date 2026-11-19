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
    expect(wheelIntent(wheel({ deltaY: 2.5, ctrlKey: true }), 1)).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: 4, metaKey: true }), 2)).toBe('zoom');
  });

  it('zooms for mouse notches in line or page mode', () => {
    expect(wheelIntent(wheel({ deltaY: 3, deltaMode: 1 }), 1)).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: 1, deltaMode: 2 }), 1)).toBe('zoom');
  });

  it('zooms for pixel notches at any browser zoom or display scaling', () => {
    expect(wheelIntent(wheel({ deltaY: 100 }), 1)).toBe('zoom');
    expect(wheelIntent(wheel({ deltaY: -120 }), 1)).toBe('zoom');
    // 110 % browser zoom: a 100 px notch arrives as 90.909… CSS px.
    expect(wheelIntent(wheel({ deltaY: 100 / 1.1 }), 1.1)).toBe('zoom');
    // 90 % browser zoom on a 150 % display.
    expect(wheelIntent(wheel({ deltaY: -100 / 1.35 }), 1.35)).toBe('zoom');
    // 125 % display scaling, browser at 100 %.
    expect(wheelIntent(wheel({ deltaY: 80 }), 1.25)).toBe('zoom');
  });

  it('pans for trackpad scrolling: small, fractional or two-axis deltas', () => {
    expect(wheelIntent(wheel({ deltaY: 4 }), 1)).toBe('pan');
    expect(wheelIntent(wheel({ deltaY: 66.5 }), 1)).toBe('pan');
    expect(wheelIntent(wheel({ deltaY: 52.3 }), 2)).toBe('pan');
    expect(wheelIntent(wheel({ deltaX: 3, deltaY: 100 }), 1)).toBe('pan');
  });

  it('pans for a mouse wheel on macOS, whose small notches look like a trackpad', () => {
    expect(wheelIntent(wheel({ deltaY: 4 }), 2)).toBe('pan');
    expect(wheelIntent(wheel({ deltaY: -12 }), 2)).toBe('pan');
  });

  it('pans with Shift', () => {
    expect(wheelIntent(wheel({ deltaY: 100, shiftKey: true }), 1)).toBe('pan');
  });
});
