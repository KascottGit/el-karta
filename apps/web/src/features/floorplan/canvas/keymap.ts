export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type KeyCommand =
  | { kind: 'cancel' }
  | { kind: 'delete' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'tool'; id: string }
  | { kind: 'action'; id: string };

export interface Shortcuts {
  tools: ReadonlyMap<string, string>;
  actions: ReadonlyMap<string, string>;
}

/** Maps a key press to an editor command. Tool and action shortcuts are single keys without modifiers. */
export function resolveKey(e: KeyInput, shortcuts: Shortcuts): KeyCommand | null {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (key === 'escape') return { kind: 'cancel' };
  if (mod && !e.altKey) {
    if (key === 'z') return { kind: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y' && !e.shiftKey) return { kind: 'redo' };
    return null;
  }
  if (e.altKey) return null;
  if (key === 'delete' || key === 'backspace') return { kind: 'delete' };
  if (e.shiftKey) return null;
  const tool = shortcuts.tools.get(key);
  if (tool) return { kind: 'tool', id: tool };
  const action = shortcuts.actions.get(key);
  if (action) return { kind: 'action', id: action };
  return null;
}
