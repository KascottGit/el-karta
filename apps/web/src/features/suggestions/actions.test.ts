import { putSpaceItem, type Suggestion } from '@el-karta/core';
import { describe, expect, it, vi } from 'vitest';
import { floorIssues } from '@/features/floorplan/validation/floor-issues';
import { modelStore } from '@/model/store';
import {
  acceptableIds,
  acceptIds,
  confidentIds,
  dependantsOf,
  editTarget,
  rejectIds,
  requirementsOf,
} from './actions';
import { loadDemo } from './fixtures';
import { suggestionsStore } from './suggestions-store';

function otherWall() {
  return {
    id: crypto.randomUUID(),
    a: { x: 50, y: 50 },
    b: { x: 52, y: 50 },
    thickness: 0.1,
    provenance: { status: 'manual' as const },
  };
}

const ids = (list: readonly Suggestion[]) => list.map((s) => s.id);
const history = () => modelStore.getState().past.length;

describe('accepting suggestions', () => {
  it('is one undo step that also accepts what the suggestion requires', async () => {
    const demo = await loadDemo();
    const [scale] = demo.byKind('scale');
    const [wall] = demo.byKind('wall');
    const before = history();

    expect(await acceptIds(demo.deps, demo.floorId, [wall!.id])).toEqual({
      ok: true,
      ids: [scale!.id, wall!.id],
    });

    const placed = demo.floor().data.walls[demo.wall(wall!).id];
    expect(placed?.provenance).toEqual({
      status: 'confirmed',
      source: 'ai:floorplan:demo',
      confidence: 0.9,
    });
    expect(demo.floor().data.scale).toEqual(scale!.payload);
    expect(history()).toBe(before + 1);
    expect(demo.status(wall!.id)).toBe('accepted');
    expect(demo.status(scale!.id)).toBe('accepted');
    expect(demo.cached().find((s) => s.id === wall!.id)?.status).toBe('accepted');

    modelStore.getState().undo();
    expect(demo.floor().data.walls).toEqual({});
    expect(demo.floor().data.scale).toBeUndefined();
  });

  it('puts the rows back to pending on undo and accepts them again on redo', async () => {
    const demo = await loadDemo();
    const [scale] = demo.byKind('scale');
    const [wall] = demo.byKind('wall');
    const statuses = () => [wall!.id, scale!.id].map((id) => [demo.status(id), cachedStatus(id)]);
    const cachedStatus = (id: string) => demo.cached().find((s) => s.id === id)?.status;
    await acceptIds(demo.deps, demo.floorId, [wall!.id]);

    modelStore.getState().undo();
    await vi.waitFor(() => {
      expect(statuses().flat()).toEqual(['pending', 'pending', 'pending', 'pending']);
    });

    modelStore.getState().redo();
    expect(demo.floor().data.walls[demo.wall(wall!).id]).toBeDefined();
    await vi.waitFor(() => {
      expect(statuses().flat()).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    });

    // After undo, a new edit drops the redo step, so the rows stay pending and are no longer followed.
    modelStore.getState().undo();
    await vi.waitFor(() => {
      expect(demo.status(wall!.id)).toBe('pending');
    });
    modelStore.getState().apply(putSpaceItem(demo.floorId, 'walls', otherWall()));
    expect(suggestionsStore.getState().accepts).toEqual([]);
    expect(demo.status(wall!.id)).toBe('pending');
  });

  it('takes the status back when the source refuses the undo', async () => {
    const demo = await loadDemo();
    const [height] = demo.byKind('floor-height');
    await acceptIds(demo.deps, demo.floorId, [height!.id]);
    demo.source.failNextStatus();

    modelStore.getState().undo();
    await vi.waitFor(() => {
      expect(demo.cached().find((s) => s.id === height!.id)?.status).toBe('accepted');
    });
    expect(demo.status(height!.id)).toBe('accepted');
  });

  it('accepts only the acceptable rows in bulk, and says why one is not', async () => {
    const demo = await loadDemo();
    const broken = { ...demo.byKind('wall')[0]!, id: crypto.randomUUID(), payload: { a: 1 } };
    const unknown = { ...demo.byKind('wall')[1]!, id: crypto.randomUUID(), kind: 'device' };
    const needsBroken = {
      ...demo.byKind('room')[0]!,
      id: crypto.randomUUID(),
      payload: { ...demo.room(demo.byKind('room')[0]!), id: crypto.randomUUID() },
      requires: [broken.id],
    };
    const all = [...demo.suggestions, broken, unknown, needsBroken];
    demo.queries.setQueryData(['suggestions', demo.source.id, demo.floorId], all);

    const ok = acceptableIds(all);
    expect(new Set(ok)).toEqual(new Set(ids(demo.suggestions)));

    expect(await acceptIds(demo.deps, demo.floorId, [needsBroken.id])).toEqual({
      ok: false,
      error: 'suggestions.errors.unreadable',
      applied: false,
    });
    expect(await acceptIds(demo.deps, demo.floorId, [unknown.id])).toMatchObject({
      error: 'suggestions.errors.unreadable',
    });
    const decision = await acceptIds(demo.deps, demo.floorId, ok);
    expect(decision.ok).toBe(true);
    expect(Object.keys(demo.floor().data.walls)).toHaveLength(4);
    expect(Object.keys(demo.floor().data.rooms)).toHaveLength(1);
  });

  it('lists the pending requirements an accept pulls in', async () => {
    const demo = await loadDemo();
    const door = demo.byKind('opening').find((s) => demo.opening(s).kind === 'door')!;
    const [scale] = demo.byKind('scale');

    expect(new Set(requirementsOf(demo.suggestions, [door.id]))).toEqual(
      new Set([...door.requires, scale!.id]),
    );
    expect(requirementsOf(demo.suggestions, [scale!.id])).toEqual([]);
  });

  it('accepts an opening together with its wall', async () => {
    const demo = await loadDemo();
    const door = demo.byKind('opening').find((s) => demo.opening(s).kind === 'door')!;
    const wall = demo.byKind('wall').find((s) => door.requires.includes(s.id))!;

    const decision = await acceptIds(demo.deps, demo.floorId, [door.id]);

    expect(decision.ok).toBe(true);
    const { data } = demo.floor();
    expect(data.openings[demo.opening(door).id]?.wallId).toBe(demo.wall(wall).id);
    expect(data.walls[demo.wall(wall).id]).toBeDefined();
    expect(demo.status(wall.id)).toBe('accepted');
  });

  it('keeps the edit and the rows pending when marking fails, and accepting again adds nothing twice', async () => {
    const demo = await loadDemo();
    const [wall] = demo.byKind('wall');
    demo.source.failNextStatus();

    expect(await acceptIds(demo.deps, demo.floorId, [wall!.id])).toEqual({
      ok: false,
      error: 'suggestions.errors.saveAccepted',
      applied: true,
    });
    const afterFirst = demo.floor().data;
    expect(Object.keys(afterFirst.walls)).toEqual([demo.wall(wall!).id]);
    expect(demo.status(wall!.id)).toBe('pending');
    expect(demo.cached().find((s) => s.id === wall!.id)?.status).toBe('pending');

    expect((await acceptIds(demo.deps, demo.floorId, [wall!.id])).ok).toBe(true);
    expect(demo.floor().data.walls).toEqual(afterFirst.walls);
    expect(demo.floor().data.scale).toEqual(afterFirst.scale);
    expect(demo.status(wall!.id)).toBe('accepted');
  });

  it('refuses a suggestion whose requirement was rejected, without touching the floor', async () => {
    const demo = await loadDemo();
    const [scale] = demo.byKind('scale');
    const [wall] = demo.byKind('wall');
    await rejectIds(demo.deps, demo.floorId, [scale!.id]);
    // As if another member had rejected only the scale.
    demo.queries.setQueryData(
      ['suggestions', demo.source.id, demo.floorId],
      demo.cached().map((s) => (s.id === wall!.id ? { ...s, status: 'pending' as const } : s)),
    );
    const before = demo.floor();

    expect(await acceptIds(demo.deps, demo.floorId, [wall!.id])).toEqual({
      ok: false,
      error: 'suggestions.errors.requirementRejected',
      applied: false,
    });
    expect(demo.floor()).toBe(before);
  });
});

describe('rejecting suggestions', () => {
  it('leaves the floor unchanged when everything is rejected', async () => {
    const demo = await loadDemo();
    const before = demo.floor();
    const steps = history();

    const decision = await rejectIds(demo.deps, demo.floorId, ids(demo.suggestions));

    expect(decision).toEqual({ ok: true, ids: ids(demo.suggestions) });
    expect(demo.floor()).toBe(before);
    expect(history()).toBe(steps);
    expect(demo.source.rows().every((s) => s.status === 'rejected')).toBe(true);
  });

  it('rejects the pending suggestions that require the rejected one, through every level', async () => {
    const demo = await loadDemo();
    const [scale] = demo.byKind('scale');
    const dependants = [...demo.byKind('wall'), ...demo.byKind('opening'), ...demo.byKind('room')];

    expect(new Set(dependantsOf(demo.suggestions, [scale!.id]))).toEqual(new Set(ids(dependants)));
    const decision = await rejectIds(demo.deps, demo.floorId, [scale!.id]);

    expect(decision.ok && new Set(decision.ids)).toEqual(new Set([scale!.id, ...ids(dependants)]));
    expect(demo.status(demo.byKind('floor-height')[0]!.id)).toBe('pending');
  });

  it('puts the rows back to pending when the source refuses', async () => {
    const demo = await loadDemo();
    const [height] = demo.byKind('floor-height');
    demo.source.failNextStatus();

    expect(await rejectIds(demo.deps, demo.floorId, [height!.id])).toEqual({
      ok: false,
      error: 'suggestions.errors.saveRejected',
      applied: false,
    });
    expect(demo.cached().find((s) => s.id === height!.id)?.status).toBe('pending');
  });
});

describe('confidentIds', () => {
  it('takes suggestions at or above the threshold whose requirements reach it too', async () => {
    const demo = await loadDemo();
    const kinds = new Map(demo.suggestions.map((s) => [s.id, `${s.kind}:${String(s.confidence)}`]));

    const picked = confidentIds(demo.suggestions, 0.8).map((id) => kinds.get(id));

    // The door (0.8) is left out because its wall has 0.7.
    expect(picked).toEqual(['scale:0.9', 'floor-height:0.9', 'wall:0.9', 'wall:0.85', 'room:0.85']);
    expect(confidentIds(demo.suggestions, 0.95)).toEqual([]);
    expect(confidentIds(demo.suggestions, 0)).toHaveLength(demo.suggestions.length);
  });

  it('counts an accepted requirement as met and a rejected one as not', async () => {
    const demo = await loadDemo();
    const door = demo.byKind('opening').find((s) => s.confidence === 0.8)!;
    const decided = (status: 'accepted' | 'rejected') =>
      demo.suggestions.map((s) =>
        s.kind === 'scale' || door.requires.includes(s.id) ? { ...s, status } : s,
      );

    expect(confidentIds(decided('accepted'), 0.8)).toContain(door.id);
    expect(confidentIds(decided('rejected'), 0.8)).not.toContain(door.id);
  });
});

describe('editTarget', () => {
  it('names the model item an accepted suggestion became, and nothing for floor values', async () => {
    const demo = await loadDemo();
    const [wall] = demo.byKind('wall');
    const [room] = demo.byKind('room');

    expect(editTarget(wall!)).toEqual({ collection: 'walls', id: demo.wall(wall!).id });
    expect(editTarget(room!)).toEqual({
      collection: 'rooms',
      id: demo.room(room!).id,
    });
    expect(editTarget(demo.byKind('scale')[0]!)).toBeNull();
  });
});

describe('pending suggestions', () => {
  it('never reach validation of the floor', async () => {
    const demo = await loadDemo();
    // An opening on a wall that is not on the floor would be `opening.wall-missing` as model data.
    const door = demo.opening(demo.byKind('opening')[0]!);

    expect(floorIssues(demo.floor())).toEqual([]);

    modelStore
      .getState()
      .apply(putSpaceItem(demo.floorId, 'openings', { ...door, provenance: { status: 'manual' } }));
    expect(
      floorIssues(demo.floor()).filter(
        (i) => i.code === 'opening.wall-missing' && i.ids.includes(door.id),
      ),
    ).toHaveLength(1);
  });
});
