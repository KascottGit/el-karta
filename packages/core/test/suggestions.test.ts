import { describe, expect, it } from 'vitest';
import {
  acceptSuggestions,
  applyEdit,
  createSuggestionKinds,
  SuggestionError,
  type Suggestion,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

function setup() {
  const b = new ModelBuilder();
  const model = b.build();
  const floorId = b.floors[0]!.id;
  const wallId = b.id();
  const base = {
    projectId: model.project.id,
    floorId,
    runId: null,
    pass: 'floorplan',
    source: 'ai:floorplan:test',
    issues: [],
    status: 'pending' as const,
  };
  const wall: Suggestion = {
    ...base,
    id: b.id(),
    kind: 'wall',
    payload: { id: wallId, a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1 },
    confidence: 0.8,
    requires: [],
  };
  const door: Suggestion = {
    ...base,
    id: b.id(),
    kind: 'opening',
    payload: { id: b.id(), wallId, kind: 'door', offset: 1, width: 0.9, height: 2.1 },
    requires: [wall.id],
  };
  const scale: Suggestion = {
    ...base,
    id: b.id(),
    kind: 'scale',
    payload: { source: 'ai_estimate', metresPerPixel: 0.02 },
    requires: [],
  };
  return { model, floorId, wall, door, scale, kinds: createSuggestionKinds() };
}

describe('acceptSuggestions', () => {
  it('accepts required suggestions first, in one edit, with confirmed provenance', () => {
    const { model, floorId, wall, door, kinds } = setup();
    const plan = acceptSuggestions(kinds, [wall, door], [door.id]);
    expect(plan.accepted.map((s) => s.id)).toEqual([wall.id, door.id]);
    const { model: next } = applyEdit(model, plan.edit);
    const data = next.floors[floorId]!.data;
    expect(Object.values(data.walls)[0]!.provenance).toEqual({
      status: 'confirmed',
      source: 'ai:floorplan:test',
      confidence: 0.8,
    });
    expect(Object.values(data.openings)[0]!.provenance).toEqual({
      status: 'confirmed',
      source: 'ai:floorplan:test',
    });
  });

  it('skips requirements that were already accepted', () => {
    const { wall, door, kinds } = setup();
    const plan = acceptSuggestions(kinds, [{ ...wall, status: 'accepted' }, door], [door.id]);
    expect(plan.accepted.map((s) => s.id)).toEqual([door.id]);
  });

  it('refuses an item whose requirement was rejected', () => {
    const { wall, door, kinds } = setup();
    expect(() =>
      acceptSuggestions(kinds, [{ ...wall, status: 'rejected' }, door], [door.id]),
    ).toThrow(SuggestionError);
  });

  it('sets floor-level values', () => {
    const { model, floorId, scale, kinds } = setup();
    const { model: next } = applyEdit(model, acceptSuggestions(kinds, [scale], [scale.id]).edit);
    expect(next.floors[floorId]!.data.scale).toEqual({
      source: 'ai_estimate',
      metresPerPixel: 0.02,
    });
  });

  it('keeps a scale the person measured when a suggested scale is accepted', () => {
    const { model, floorId, scale, kinds } = setup();
    const measured = { source: 'user' as const, metresPerPixel: 0.008 };
    model.floors[floorId]!.data.scale = measured;
    const { model: next } = applyEdit(model, acceptSuggestions(kinds, [scale], [scale.id]).edit);
    expect(next.floors[floorId]!.data.scale).toEqual(measured);
  });

  it('rejects payloads that do not fit the kind', () => {
    const { model, wall, kinds } = setup();
    const broken = { ...wall, payload: { id: 'x' } };
    expect(() => applyEdit(model, acceptSuggestions(kinds, [broken], [broken.id]).edit)).toThrow();
  });

  it('reports the model id of the accepted item', () => {
    const { wall, scale, kinds } = setup();
    expect(kinds.get('wall')!.itemId(wall.payload)).toBe((wall.payload as { id: string }).id);
    expect(kinds.get('scale')!.itemId(scale.payload)).toBeNull();
  });
});
