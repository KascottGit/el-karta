import type { Id, Pt, Suggestion } from '@el-karta/core';
import i18n from '@/i18n';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CanvasContext, CanvasPointer } from '@/features/floorplan/canvas/extension';
import { DEFAULT_TOOL, editorStore, type EditorState } from '@/features/floorplan/editor-store';
import { suggestionKinds } from './actions';
import { demoSource } from './dev-seed';
import { loadDemo } from './fixtures';
import { createGhostBuilder, parsePayload } from './ghosts';
import { createMemorySource } from './source';
import { onFloor, publishGhosts, suggestionsStore } from './suggestions-store';
import { reviewPromptVisible, suggestionsTool } from './tool';
import { suggestionView } from './views';

const ctx = (floorId: Id): CanvasContext => ({
  floorId,
  itemAt: () => null,
  pxToWorld: (px) => px / 100,
  zoomToFit: () => {},
});

const tap = (world: Pt, kind: CanvasPointer['kind'] = 'touch'): CanvasPointer => ({
  world,
  screen: { x: world.x * 100, y: world.y * 100 },
  kind,
  shiftKey: false,
  altKey: false,
  modKey: false,
  onHandle: false,
});

const selected = (floorId: Id) => onFloor(suggestionsStore.getState().selected, floorId);

describe('suggestionsTool', () => {
  let demo: Awaited<ReturnType<typeof loadDemo>>;
  let corner: Pt;
  beforeEach(async () => {
    demo = await loadDemo();
    publishGhosts(
      demo.floorId,
      createGhostBuilder(suggestionKinds)(demo.suggestions, {}),
      demo.suggestions.length,
    );
    corner = demo.room(demo.byKind('room')[0]!).polygon[0]!;
  });

  it('selects the ghost under a tap and clears it on a tap elsewhere', () => {
    const room = demo.byKind('room')[0]!;
    suggestionsTool.onTap!(tap({ x: corner.x + 2, y: corner.y + 1.5 }), ctx(demo.floorId));
    expect(selected(demo.floorId)).toBe(room.id);

    suggestionsTool.onTap!(tap({ x: corner.x - 3, y: corner.y }), ctx(demo.floorId));
    expect(selected(demo.floorId)).toBeNull();
  });

  it('reaches a finger further than a mouse', () => {
    const near = { x: corner.x - 0.15, y: corner.y + 1 };
    suggestionsTool.onTap!(tap(near, 'mouse'), ctx(demo.floorId));
    expect(selected(demo.floorId)).toBeNull();
    suggestionsTool.onTap!(tap(near, 'touch'), ctx(demo.floorId));
    expect(demo.byKind('wall').map((s) => s.id)).toContain(selected(demo.floorId));
  });

  it('ignores ghosts published for another floor', () => {
    suggestionsTool.onTap!(tap({ x: corner.x + 2, y: corner.y + 1.5 }), ctx(crypto.randomUUID()));
    expect(selected(demo.floorId)).toBeNull();
  });

  it('clears the selection on Escape before Escape does anything else', () => {
    suggestionsTool.onTap!(tap({ x: corner.x + 2, y: corner.y + 1.5 }), ctx(demo.floorId));
    const escape = { key: 'Escape' } as KeyboardEvent;
    expect(suggestionsTool.onKeyDown!(escape, ctx(demo.floorId))).toBe(true);
    expect(selected(demo.floorId)).toBeNull();
    expect(suggestionsTool.onKeyDown!(escape, ctx(demo.floorId))).toBe(false);
  });
});

describe('reviewPromptVisible', () => {
  it('shows with the select tool while the open floor has pending suggestions', async () => {
    const demo = await loadDemo();
    const editor = (tool: string, floorId: Id | null = demo.floorId): EditorState => ({
      ...editorStore.getState(),
      tool,
      floorId,
    });
    publishGhosts(demo.floorId, {}, 2);

    expect(reviewPromptVisible(editor(DEFAULT_TOOL))).toBe(true);
    expect(reviewPromptVisible(editor('suggestions'))).toBe(false);
    expect(reviewPromptVisible(editor('wall'))).toBe(false);
    expect(reviewPromptVisible(editor(DEFAULT_TOOL, crypto.randomUUID()))).toBe(false);
    publishGhosts(demo.floorId, {}, 0);
    expect(reviewPromptVisible(editor(DEFAULT_TOOL))).toBe(false);
  });
});

describe('createMemorySource', () => {
  it('seeds a floor once and keeps decisions', async () => {
    const demo = await loadDemo();
    const source = demoSource();
    const first = await source.list(demo.floorId);
    expect(first).toHaveLength(demo.suggestions.length);

    await source.setStatus([first[0]!.id], 'rejected');
    const again = await source.list(demo.floorId);
    expect(again.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(again[0]!.status).toBe('rejected');
    expect(await source.list(crypto.randomUUID())).toEqual([]);
  });

  it('refuses unknown ids and fails on request', async () => {
    const source = createMemorySource();
    await expect(source.setStatus(['nope'], 'accepted')).rejects.toThrow('nope');
    source.failNextStatus();
    await expect(source.setStatus([], 'accepted')).rejects.toThrow();
    await expect(source.setStatus([], 'accepted')).resolves.toBeUndefined();
  });
});

describe('suggestion views', () => {
  const describeFirst = (list: readonly Suggestion[], kind: string) => {
    const s = list.find((x) => x.kind === kind)!;
    return suggestionView(kind).describe(parsePayload(suggestionKinds, s), i18n.t);
  };

  it('say floor values and items in Swedish', async () => {
    const demo = await loadDemo();
    expect(describeFirst(demo.suggestions, 'scale')).toBe(
      'Skala: 1 bildpunkt = 12 mm (från måttangivelse)',
    );
    expect(describeFirst(demo.suggestions, 'floor-height')).toBe('Våningshöjd 2,55 m');
    expect(describeFirst(demo.suggestions, 'wall')).toBe('Vägg 4 m');
    expect(describeFirst(demo.suggestions, 'opening')).toBe('Dörr 0,9 m');
    expect(describeFirst(demo.suggestions, 'room')).toBe('Sovrum');
    expect(suggestionView('device').describe(null, i18n.t)).toBe('Förslag av typen device');
  });
});
