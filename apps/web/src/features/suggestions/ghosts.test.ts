import type { Pt, Suggestion } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { suggestionKinds } from './actions';
import { loadDemo } from './fixtures';
import { createGhostBuilder, ghostAt, ghostBounds, type Ghost } from './ghosts';
import { confidenceTier, ghostColor } from './ghost-style';
import { suggestionStyle, issueColors, canvasColors } from '@/features/floorplan/canvas/theme';

const pt = (x: number, y: number): Pt => ({ x, y });

async function demoGhosts() {
  const demo = await loadDemo();
  const build = createGhostBuilder(suggestionKinds);
  const ghosts = build(demo.suggestions, {});
  const of = (s: Suggestion) => ghosts[s.id];
  return { demo, build, ghosts, of };
}

describe('createGhostBuilder', () => {
  it('draws every pending suggestion with a shape, and no floor-level values', async () => {
    const { demo, ghosts } = await demoGhosts();
    const drawn = Object.values(ghosts).map((g) => g.suggestion.kind);

    expect(drawn.sort()).toEqual(['opening', 'opening', 'room', 'wall', 'wall', 'wall', 'wall']);
    expect(demo.byKind('scale').some((s) => s.id in ghosts)).toBe(false);
  });

  it('places an opening on the suggested wall its payload names', async () => {
    const { demo, of } = await demoGhosts();
    const door = demo.byKind('opening').find((s) => demo.opening(s).kind === 'door')!;
    const wall = demo.wall(demo.byKind('wall').find((s) => door.requires.includes(s.id))!);
    const { offset, width } = demo.opening(door);

    const shape = of(door)!.shape;
    const dir = Math.sign(wall.b.x - wall.a.x);
    expect(shape).toMatchObject({
      type: 'line',
      role: 'opening',
      a: { x: wall.a.x + dir * offset, y: wall.a.y },
      b: { x: wall.a.x + dir * (offset + width), y: wall.a.y },
      thickness: wall.thickness,
    });
  });

  it('places an opening on a wall of the floor, and skips one whose wall is nowhere', async () => {
    const { demo } = await demoGhosts();
    const door = demo.byKind('opening')[0]!;
    const wallId = demo.opening(door).wallId;
    const alone = [door];
    const build = createGhostBuilder(suggestionKinds);

    expect(build(alone, {})).toEqual({});
    const onFloor = build(alone, { [wallId]: { a: pt(0, 0), b: pt(0, 5), thickness: 0.2 } });
    expect(onFloor[door.id]?.shape).toMatchObject({ a: { x: 0 }, b: { x: 0 }, thickness: 0.2 });
  });

  it('leaves out decided suggestions and payloads that do not fit their kind', async () => {
    const { demo } = await demoGhosts();
    const [first, second, third] = demo.byKind('wall');
    const list = [
      { ...first!, status: 'accepted' as const },
      { ...second!, status: 'rejected' as const },
      { ...third!, payload: { a: 'nowhere' } },
      { ...third!, id: crypto.randomUUID(), kind: 'unknown-kind' },
    ];

    expect(createGhostBuilder(suggestionKinds)(list, {})).toEqual({});
  });

  it('reuses ghosts and the record while nothing they show changed', async () => {
    const { demo, build, ghosts } = await demoGhosts();
    const door = demo.byKind('opening')[0]!;
    const wallId = demo.opening(door).wallId;
    const other = { a: pt(50, 50), b: pt(52, 50), thickness: 0.1 };

    expect(build(demo.suggestions, {})).toBe(ghosts);
    expect(build([...demo.suggestions], { other })).toBe(ghosts);

    // The floor gets a wall with the door's wall id (say it was accepted): only the door moves.
    const moved = build(demo.suggestions, {
      [wallId]: { a: pt(0, 0), b: pt(0, 5), thickness: 0.3 },
    });
    expect(moved).not.toBe(ghosts);
    expect(moved[door.id]).not.toBe(ghosts[door.id]);
    const room = demo.byKind('room')[0]!;
    expect(moved[room.id]).toBe(ghosts[room.id]);
  });
});

describe('ghostAt', () => {
  it('prefers openings over walls over rooms, within the tolerance', async () => {
    const { demo, ghosts, of } = await demoGhosts();
    const door = demo.byKind('opening').find((s) => demo.opening(s).kind === 'door')!;
    const doorShape = of(door)!.shape as Extract<Ghost['shape'], { type: 'line' }>;
    const room = demo.byKind('room')[0]!;
    const [corner] = demo.room(room).polygon;
    const all = Object.values(ghosts);
    const mid = (a: Pt, b: Pt) => pt((a.x + b.x) / 2, (a.y + b.y) / 2);

    expect(ghostAt(all, mid(doorShape.a, doorShape.b), 0.05)?.suggestion.id).toBe(door.id);
    expect(ghostAt(all, pt(corner!.x + 0.2, corner!.y), 0.05)?.suggestion.kind).toBe('wall');
    expect(ghostAt(all, pt(corner!.x + 2, corner!.y + 1.5), 0.05)?.suggestion.id).toBe(room.id);
    expect(ghostAt(all, pt(corner!.x - 1, corner!.y - 1), 0.05)).toBeNull();
    expect(ghostAt(all, pt(corner!.x - 0.2, corner!.y + 1), 0.2)?.suggestion.kind).toBe('wall');
  });
});

describe('ghostBounds', () => {
  it('covers a line ghost with half its thickness and an area ghost with its polygon', async () => {
    const { demo, of } = await demoGhosts();
    const room = demo.byKind('room')[0]!;
    const [first] = demo.byKind('wall');
    const wall = demo.wall(first!);

    expect(ghostBounds(of(room)!)).toEqual({
      minX: wall.a.x,
      minY: wall.a.y,
      maxX: wall.a.x + 4,
      maxY: wall.a.y + 3,
    });
    expect(ghostBounds(of(first!)!)).toEqual({
      minX: wall.a.x - 0.075,
      minY: wall.a.y - 0.075,
      maxX: wall.b.x + 0.075,
      maxY: wall.b.y + 0.075,
    });
  });
});

describe('ghost colours', () => {
  it('follow the confidence tiers, with no confidence counting as low', () => {
    expect(confidenceTier(0.8)).toBe('high');
    expect(confidenceTier(0.79)).toBe('medium');
    expect(confidenceTier(0.5)).toBe('medium');
    expect(confidenceTier(0.49)).toBe('low');
    expect(confidenceTier(undefined)).toBe('low');
  });

  it('show selection over issues over confidence', () => {
    expect(ghostColor(0.9, null, false)).toBe(suggestionStyle.stroke.high);
    expect(ghostColor(0.9, 'warning', false)).toBe(issueColors.warning);
    expect(ghostColor(0.9, 'error', true)).toBe(canvasColors.selected);
  });
});
