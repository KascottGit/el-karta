import type { Suggestion } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { ID, outlet, WALLED, walledKitchen } from '@/features/photos/test-fixtures';
import { suggestionKinds } from './actions';
import { createGhostBuilder, ghostAt } from './ghosts';
import { suggestionView } from './views';

const { model, floorId } = walledKitchen();
const floor = model.floors[floorId]!.data;
const t = i18n.t;

const pending = (kind: string, payload: unknown): Suggestion => ({
  id: crypto.randomUUID(),
  projectId: model.project.id,
  floorId,
  runId: null,
  pass: 'photo',
  kind,
  source: 'ai:photo:m',
  payload,
  issues: [],
  requires: [],
  status: 'pending',
});

describe('corrections', () => {
  const window = floor.openings[WALLED.window]!;

  it('say what an opening correction changes, from the opening on the floor', () => {
    const view = suggestionView('opening');
    const wider = { ...window, width: 1.2 };
    expect(view.describe(wider, t, floor)).toBe('Fönster: bredd 1,00 → 1,20 m');
    const both = { ...wider, height: 1.3, sill: 0.8 };
    expect(view.describe(both, t, floor)).toBe(
      'Fönster: bredd 1,00 → 1,20 m, höjd 1,20 → 1,30 m, bröstningshöjd 0,90 → 0,80 m',
    );
    // A new opening is not a change.
    expect(view.describe({ ...wider, id: crypto.randomUUID() }, t, floor)).toBe('Fönster 1,2 m');
    expect(view.describe(wider, t)).toBe('Fönster 1,2 m');
  });

  it('say what a ceiling height changes, from the room’s or else the floor’s height', () => {
    const view = suggestionView('room-ceiling-height');
    const payload = { roomId: ID.kitchen, ceilingHeight: 2.6 };
    expect(view.describe(payload, t, { ...floor, height: 2.5 })).toBe(
      'Takhöjd i Kök: 2,50 → 2,60 m',
    );
    const kitchen = { ...floor.rooms[ID.kitchen]!, ceilingHeight: 2.4 };
    expect(view.describe(payload, t, { ...floor, rooms: { [ID.kitchen]: kitchen } })).toBe(
      'Takhöjd i Kök: 2,40 → 2,60 m',
    );
    expect(view.describe(payload, t)).toBe(`Takhöjd i ${t('areas.room')}: 2,6 m`);
  });
});

describe('device suggestions', () => {
  it('are named by type, with the count of sockets in one frame', () => {
    const view = suggestionView('device');
    expect(view.describe({ ...outlet('a'), count: 2 }, t)).toBe('Vägguttag, 2 st');
    expect(view.describe({ ...outlet('a'), type: 'switch' }, t)).toBe('Strömbrytare');
    expect(view.collection).toBe('devices');
  });

  it('are ghosted as their type’s marker on the wall face or under the ceiling, and win a tap over an opening', () => {
    // The outlet sits 1 m along the top wall (0,0)→(4,0), on its kitchen face 0.1 m below.
    const onWall = pending('device', { ...outlet('a'), id: crypto.randomUUID() });
    const light = pending('device', {
      ...outlet('b'),
      id: crypto.randomUUID(),
      type: 'ceiling_light',
      placement: { kind: 'ceiling', roomId: ID.kitchen, at: { x: 2, y: 1.5 } },
    });
    const wider = pending('opening', {
      ...floor.openings[WALLED.window]!,
      offset: 0.8,
      width: 1.4,
    });
    const ghosts = createGhostBuilder(suggestionKinds)([onWall, light, wider], floor.walls);

    expect(ghosts[onWall.id]!.shape).toEqual({
      type: 'marker',
      role: 'device',
      at: { x: 1, y: 0.1 },
      shape: 'circle',
    });
    expect(ghosts[light.id]!.shape).toMatchObject({ at: { x: 2, y: 1.5 }, shape: 'triangle' });
    expect(ghostAt(Object.values(ghosts), { x: 1, y: 0.05 }, 0.2)?.suggestion.id).toBe(onWall.id);
    expect(ghostAt(Object.values(ghosts), { x: 1.8, y: 0 }, 0.2)?.suggestion.id).toBe(wider.id);
  });
});
