import { describe, expect, it } from 'vitest';
import { resolveKey, type KeyInput } from './keymap';

const shortcuts = {
  tools: new Map([
    ['v', 'select'],
    ['w', 'wall'],
  ]),
  actions: new Map([['f', 'zoom-to-fit']]),
};

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('resolveKey', () => {
  it('maps Escape, Delete and Backspace', () => {
    expect(resolveKey(key('Escape'), shortcuts)).toEqual({ kind: 'cancel' });
    expect(resolveKey(key('Delete'), shortcuts)).toEqual({ kind: 'delete' });
    expect(resolveKey(key('Backspace'), shortcuts)).toEqual({ kind: 'delete' });
  });

  it('maps Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z or Ctrl+Y to redo', () => {
    expect(resolveKey(key('z', { ctrlKey: true }), shortcuts)).toEqual({ kind: 'undo' });
    expect(resolveKey(key('z', { metaKey: true }), shortcuts)).toEqual({ kind: 'undo' });
    expect(resolveKey(key('Z', { ctrlKey: true, shiftKey: true }), shortcuts)).toEqual({
      kind: 'redo',
    });
    expect(resolveKey(key('Z', { metaKey: true, shiftKey: true }), shortcuts)).toEqual({
      kind: 'redo',
    });
    expect(resolveKey(key('y', { ctrlKey: true }), shortcuts)).toEqual({ kind: 'redo' });
  });

  it('maps registered tool and action keys, only without modifiers', () => {
    expect(resolveKey(key('w'), shortcuts)).toEqual({ kind: 'tool', id: 'wall' });
    expect(resolveKey(key('W', { shiftKey: true }), shortcuts)).toBeNull();
    expect(resolveKey(key('f'), shortcuts)).toEqual({ kind: 'action', id: 'zoom-to-fit' });
    expect(resolveKey(key('w', { ctrlKey: true }), shortcuts)).toBeNull();
    expect(resolveKey(key('w', { altKey: true }), shortcuts)).toBeNull();
    expect(resolveKey(key('q'), shortcuts)).toBeNull();
  });
});
