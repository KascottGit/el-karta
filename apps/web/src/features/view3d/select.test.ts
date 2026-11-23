import { describe, expect, it, vi } from 'vitest';
import { createEditorStore } from '@/features/floorplan/editor-store';
import { selectPicked } from './select';

function setup() {
  const store = createEditorStore();
  store.getState().openFloor('one');
  const openFloor = vi.fn();
  const tap = (item: Parameters<typeof selectPicked>[0], additive = false) => {
    selectPicked(item, additive, openFloor, store);
  };
  return { store, openFloor, tap };
}

const wall = { floorId: 'one', collection: 'walls' as const, id: 'w' };
const room = { floorId: 'one', collection: 'rooms' as const, id: 'r' };

describe('selectPicked', () => {
  it('selects the item, toggles it with a modifier, and clears on empty space', () => {
    const { store, tap, openFloor } = setup();
    tap(wall);
    expect(store.getState().selection).toEqual([{ collection: 'walls', id: 'w' }]);
    tap(room, true);
    expect(store.getState().selection).toHaveLength(2);
    tap(wall, true);
    expect(store.getState().selection).toEqual([{ collection: 'rooms', id: 'r' }]);
    tap(null, true);
    expect(store.getState().selection).toHaveLength(1);
    tap(null);
    expect(store.getState().selection).toEqual([]);
    expect(openFloor).not.toHaveBeenCalled();
  });

  it('opens another floor with the item selected there', () => {
    const { store, tap, openFloor } = setup();
    tap(wall);
    tap({ floorId: 'two', collection: 'devices', id: 'd' });
    expect(openFloor).toHaveBeenCalledWith('two');
    expect(store.getState().floorId).toBe('two');
    expect(store.getState().selection).toEqual([{ collection: 'devices', id: 'd' }]);
  });
});
