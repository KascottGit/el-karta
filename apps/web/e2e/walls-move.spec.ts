import { expect, test, type Page } from '@playwright/test';
import { readEditor, readOpenFloor, readSelection, worldToPage, type Pt } from './app-modules';
import { openSynthetic } from './editor';
import { finger, mouse, type Input } from './input';

interface Wall {
  id: string;
  a: Pt;
  b: Pt;
}
interface FloorSnapshot {
  walls: Record<string, Wall>;
  openings: Record<string, { wallId: string; offset: number; width: number }>;
  devices: Record<
    string,
    { placement: { kind: string; at?: Pt; wallId?: string; offset?: number } }
  >;
}

const MOVE = 0.4;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const along = (w: Wall, t: number): Pt => ({
  x: w.a.x + (w.b.x - w.a.x) * t,
  y: w.a.y + (w.b.y - w.a.y) * t,
});
/** The wall's left unit normal in y-down plan coordinates. */
const normalOf = (w: Wall): Pt => {
  const len = dist(w.a, w.b);
  return { x: (w.b.y - w.a.y) / len, y: -(w.b.x - w.a.x) / len };
};
/** Signed distance of `p` from the wall's line along its left normal. */
const offsetOf = (w: Wall, p: Pt) => {
  const n = normalOf(w);
  return (p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y;
};

const readFloor = (page: Page) =>
  readOpenFloor<FloorSnapshot>(page, ['walls', 'openings', 'devices']);

/** Walls of the floor with an end within a centimetre of `p`, other than `except`. */
const endsAt = (walls: Wall[], p: Pt, except: string) =>
  walls.flatMap((w) =>
    w.id === except
      ? []
      : (['a', 'b'] as const).filter((e) => dist(w[e], p) <= 0.01).map((end) => ({ w, end })),
  );

/**
 * A straight room wall joined to other walls at both ends, with a spot on it clear of openings,
 * devices and T-junctions, that stays inside `area` (page pixels) when moved `MOVE` metres.
 */
async function findWall(page: Page, area: { x0: number; x1: number; y0: number; y1: number }) {
  const { walls, openings, devices } = await readFloor(page);
  const toPage = await worldToPage(page);
  const all = Object.values(walls);
  const inArea = (p: Pt) => {
    const s = toPage(p);
    return s.x > area.x0 && s.x < area.x1 && s.y > area.y0 && s.y < area.y1;
  };
  for (const w of all) {
    const len = dist(w.a, w.b);
    const axis = Math.abs(w.a.x - w.b.x) < 1e-6 || Math.abs(w.a.y - w.b.y) < 1e-6;
    const joined = (['a', 'b'] as const).every((e) => {
      const others = endsAt(all, w[e], w.id);
      return others.length > 0 && others.every(({ w: o }) => dist(o.a, o.b) > 1.5);
    });
    if (len < 2 || !axis || !joined) continue;
    const n = normalOf(w);
    for (let t = 0.15; t <= 0.85; t += 0.05) {
      const at = along(w, t);
      const offset = t * len;
      const clear =
        Object.values(openings).every(
          (o) => o.wallId !== w.id || offset < o.offset - 0.4 || offset > o.offset + o.width + 0.4,
        ) &&
        Object.values(devices).every(({ placement: p }) =>
          p.wallId === w.id
            ? Math.abs((p.offset ?? 0) - offset) > 0.5
            : !p.at || dist(p.at, at) > 0.5,
        ) &&
        all.every((o) => o.id === w.id || (dist(o.a, at) > 0.5 && dist(o.b, at) > 0.5));
      const to = { x: at.x + n.x * MOVE, y: at.y + n.y * MOVE };
      if (clear && inArea(at) && inArea(to)) return { wall: w, at, to };
    }
  }
  throw new Error(`No movable wall in ${JSON.stringify(area)}`);
}

/** The walls connected to `wall` at its ends, as `{ id, end }`. */
const neighbours = (walls: Record<string, Wall>, wall: Wall) =>
  (['a', 'b'] as const).map((e) =>
    endsAt(Object.values(walls), wall[e], wall.id).map(({ w, end }) => ({ id: w.id, end, of: e })),
  );

/** The wall moved about `MOVE` metres along its normal, and every neighbour still joined to it. */
async function expectMoved(page: Page, before: Record<string, Wall>, wall: Wall) {
  const { walls } = await readFloor(page);
  const moved = walls[wall.id]!;
  expect(offsetOf(wall, moved.a)).toBeCloseTo(offsetOf(wall, moved.b), 6);
  expect(Math.abs(offsetOf(wall, moved.a) - MOVE)).toBeLessThan(0.12);
  const joined = neighbours(before, wall).flat();
  expect(joined.length).toBeGreaterThan(0);
  for (const { id, end, of } of joined) expect(dist(walls[id]![end], moved[of])).toBeLessThan(1e-6);
}

/**
 * Selects a room wall and drags it, then checks undo; drags it unselected, which pans; and drags
 * it with the move-wall tool.
 */
async function moveRoomWall(page: Page, input: Input, area: (box: DOMRectLike) => Area) {
  const box = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  const { wall, at, to } = await findWall(page, area(box));
  const before = (await readFloor(page)).walls;
  let toPage = await worldToPage(page);

  await input.tap(toPage(at));
  expect(await readSelection(page)).toEqual([{ collection: 'walls', id: wall.id }]);
  await input.drag(toPage(at), toPage(to));
  await expectMoved(page, before, wall);
  await input.button('Ångra');
  expect((await readFloor(page)).walls).toEqual(before);

  // Unselected, a drag on the wall pans the view and leaves the wall alone.
  await page.keyboard.press('Escape');
  await expect.poll(() => readSelection(page)).toEqual([]);
  const viewBefore = (await readEditor(page)).viewport;
  const from = toPage(at);
  await input.drag(from, { x: from.x + 30, y: from.y + 50 });
  expect((await readFloor(page)).walls).toEqual(before);
  const viewAfter = (await readEditor(page)).viewport;
  expect(viewAfter.x - viewBefore.x).toBeCloseTo(30, 0);
  expect(viewAfter.y - viewBefore.y).toBeCloseTo(50, 0);

  // The move-wall tool moves it without selecting it first.
  await input.button('Flytta vägg');
  toPage = await worldToPage(page);
  await input.drag(toPage(at), toPage(to));
  await expectMoved(page, before, wall);
  expect(await readSelection(page)).toEqual([]);
  await input.button('Ångra');
  expect((await readFloor(page)).walls).toEqual(before);
}

interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Area {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

test('moving a selected wall with the mouse keeps its neighbours joined', async ({ page }) => {
  await openSynthetic(page, 'small');
  // Clear of the toolbar on the left and the side panel at the top right.
  await moveRoomWall(page, mouse(page), (b) => ({
    x0: b.x + 80,
    x1: b.x + b.width - 360,
    y0: b.y + 40,
    y1: b.y + b.height - 80,
  }));
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('moving a selected wall with a finger keeps its neighbours joined', async ({ page }) => {
    await openSynthetic(page, 'small');
    // Above the bottom sheet that opens for the selected wall.
    await moveRoomWall(page, await finger(page), (b) => ({
      x0: b.x + 40,
      x1: b.x + b.width - 40,
      y0: b.y + 60,
      y1: b.y + b.height * 0.45,
    }));
  });
});
