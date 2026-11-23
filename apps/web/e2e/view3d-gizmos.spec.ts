import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, readOpenFloor, readSelection, type Pt } from './app-modules';
import { finger, mouse, touch, type Input } from './input';
import { gizmoHandleOnPage, view3dCanvas, type HandleName, type View3dItem } from './view3d';

interface Wall {
  id: string;
  a: Pt;
  b: Pt;
}
interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'passage';
  offset: number;
  width: number;
}

const WINDOW_HANDLES: HandleName[] = ['slide', 'start', 'end', 'top', 'sill'];
const WALL_HANDLES: HandleName[] = ['move-left', 'move-right', 'corner-a', 'corner-b', 'height'];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (w: Wall) => dist(w.a, w.b);

async function readFloor(page: Page) {
  const { walls, openings } = await readOpenFloor<{
    walls: Record<string, Wall>;
    openings: Record<string, Opening>;
  }>(page, ['walls', 'openings']);
  const floorId = await page.evaluate(async (url) => {
    const { editorStore } = (await import(/* @vite-ignore */ url)) as {
      editorStore: { getState(): { floorId: string } };
    };
    return editorStore.getState().floorId;
  }, EDITOR_STORE);
  return { floorId, walls, openings };
}

/** The part of the 3D canvas, in page pixels, that the floor menu and the side panel leave clear. */
type Clear = (p: Pt) => boolean;

/** Where the handles of the shown gizmo are, in page pixels, or null unless all are in `clear`. */
async function handlesIn(page: Page, names: readonly HandleName[], clear: Clear) {
  const box = (await view3dCanvas(page).boundingBox())!;
  const handles = await page.evaluate(
    (list) => list.map((n) => window.__view3d?.gizmoHandle(n) ?? null),
    names,
  );
  const onPage = handles.map((h) => h && { x: box.x + h.x, y: box.y + h.y });
  return onPage.every((h) => h && clear(h)) ? (onPage as Pt[]) : null;
}

/**
 * Taps the first of `items` that is drawn in the clear part of the view and whose gizmo then shows
 * all of `handles` there too, and returns it.
 */
async function selectWithGizmo(
  page: Page,
  input: Input,
  items: readonly View3dItem[],
  handles: readonly HandleName[],
  clear: Clear,
) {
  const box = (await view3dCanvas(page).boundingBox())!;
  for (const item of items) {
    await page.keyboard.press('Escape');
    await expect.poll(() => readSelection(page)).toEqual([]);
    const at = await page.evaluate((i) => window.__view3d?.screenPosition(i) ?? null, item);
    const tap = at && { x: box.x + at.x, y: box.y + at.y };
    if (!tap || !clear(tap)) continue;
    await input.tap(tap);
    if (JSON.stringify(await readSelection(page)) !== JSON.stringify([selected(item)])) continue;
    const shown = await expect
      .poll(async () => (await handlesIn(page, handles, clear)) !== null, { timeout: 2000 })
      .toBe(true)
      .then(
        () => true,
        () => false,
      );
    if (shown) return item;
  }
  throw new Error('No item with its gizmo in view');
}

const selected = (item: View3dItem) => ({ collection: item.collection, id: item.id });

/** Drags a handle `px` pixels along its axis on screen; a negative `px` drags it the other way. */
async function dragHandle(page: Page, input: Input, name: HandleName, px: number) {
  const handle = await gizmoHandleOnPage(page, name);
  const axis = handle.axis!;
  await input.drag(handle, { x: handle.x + axis.x * px, y: handle.y + axis.y * px });
}

const widthText = (width: number) => String(Number(width.toFixed(3))).replace('.', ',');

/**
 * Selects a window in 3D, slides it with its arrow and widens it from one edge, checking the
 * width in the panel and undoing each in one step.
 */
async function slideAndWidenWindow(page: Page, input: Input, clear: Clear) {
  const { floorId, walls, openings } = await readFloor(page);
  const room = (o: Opening) => {
    const wall = walls[o.wallId]!;
    return { before: o.offset, after: length(wall) - o.offset - o.width };
  };
  const windows = Object.values(openings)
    .filter((o) => o.kind === 'window' && Math.max(room(o).before, room(o).after) > 0.6)
    .map((o) => ({ floorId, collection: 'openings' as const, id: o.id }));
  const item = await selectWithGizmo(page, input, windows, WINDOW_HANDLES, clear);
  const before = openings[item.id]!;
  const panel = page.getByRole('region', { name: 'Fönster', exact: true });
  await expect(panel.getByLabel('Bredd')).toHaveValue(widthText(before.width));
  const towards = room(before).after > room(before).before ? 1 : -1;

  const top = await gizmoHandleOnPage(page, 'top');
  await dragHandle(page, input, 'slide', 40 * towards);
  const slid = (await readFloor(page)).openings[item.id]!;
  expect((slid.offset - before.offset) * towards).toBeGreaterThan(0.05);
  expect(slid.width).toBe(before.width);
  await input.button('Ångra');
  expect((await readFloor(page)).openings[item.id]).toEqual(before);
  // The drag did not orbit the view: the window's handles are back where they were.
  expect(dist(await gizmoHandleOnPage(page, 'top'), top)).toBeLessThan(1);

  await dragHandle(page, input, towards > 0 ? 'end' : 'start', 30 * towards);
  const widened = (await readFloor(page)).openings[item.id]!;
  expect(widened.width - before.width).toBeGreaterThan(0.05);
  await expect(panel.getByLabel('Bredd')).toHaveValue(widthText(widened.width));
  await input.button('Ångra');
  expect((await readFloor(page)).openings[item.id]).toEqual(before);
  await expect(panel.getByLabel('Bredd')).toHaveValue(widthText(before.width));
  return item;
}

/** Wall ends within a centimetre of `p`, other than those of `except`. */
const endsAt = (walls: readonly Wall[], p: Pt, except: string) =>
  walls.flatMap((w) =>
    w.id === except
      ? []
      : (['a', 'b'] as const).filter((e) => dist(w[e], p) <= 0.01).map((end) => ({ w, end })),
  );

/**
 * Selects a room wall in 3D and moves it along its normal with the arrow on its face, checking
 * that its neighbours stay joined, and undoes it; then a drag off the handles orbits the view.
 */
async function moveWallThenOrbit(page: Page, input: Input, clear: Clear) {
  const { floorId, walls } = await readFloor(page);
  const all = Object.values(walls);
  const joined = (w: Wall) =>
    (['a', 'b'] as const).every((e) => {
      const others = endsAt(all, w[e], w.id);
      return others.length > 0 && others.every(({ w: o }) => length(o) > 1.5);
    });
  const candidates = all
    .filter((w) => length(w) > 2 && joined(w))
    .map((w) => ({ floorId, collection: 'walls' as const, id: w.id }));
  const item = await selectWithGizmo(page, input, candidates, WALL_HANDLES, clear);
  const wall = walls[item.id]!;
  const neighbours = (['a', 'b'] as const).flatMap((of) =>
    endsAt(all, wall[of], wall.id).map(({ w, end }) => ({ id: w.id, end, of })),
  );

  await dragHandle(page, input, 'move-left', 30);
  const after = (await readFloor(page)).walls;
  const moved = after[wall.id]!;
  const shift = { x: moved.a.x - wall.a.x, y: moved.a.y - wall.a.y };
  // Along the normal, the same at both ends.
  expect(Math.hypot(shift.x, shift.y)).toBeGreaterThan(0.05);
  expect(shift.x * (wall.b.x - wall.a.x) + shift.y * (wall.b.y - wall.a.y)).toBeCloseTo(0, 6);
  expect(moved.b.x - wall.b.x).toBeCloseTo(shift.x, 6);
  expect(moved.b.y - wall.b.y).toBeCloseTo(shift.y, 6);
  for (const { id, end, of } of neighbours)
    expect(dist(after[id]![end], moved[of])).toBeLessThan(1e-6);
  await input.button('Ångra');
  expect((await readFloor(page)).walls).toEqual(walls);

  // A drag that starts away from every handle orbits the view and changes nothing.
  const handles = (await handlesIn(page, WALL_HANDLES, clear))!;
  const box = (await view3dCanvas(page).boundingBox())!;
  const spots = [0.2, 0.35, 0.5, 0.65, 0.8].flatMap((fx) =>
    [0.2, 0.3, 0.4].map((fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })),
  );
  const from = spots.find((s) => clear(s) && handles.every((h) => dist(h, s) > 80))!;
  const corner = await gizmoHandleOnPage(page, 'corner-a');
  await input.drag(from, { x: from.x + 60, y: from.y + 10 });
  await expect
    .poll(async () => {
      const now = await gizmoHandleOnPage(page, 'corner-a');
      return dist(now, corner);
    })
    .toBeGreaterThan(5);
  expect((await readFloor(page)).walls).toEqual(walls);
  expect(await readSelection(page)).toEqual([selected(item)]);
}

test('a window and a wall are moved and resized with gizmos in 3D with the mouse', async ({
  page,
}) => {
  await page.goto('/dev/synthetic/small?view=3d');
  await expect(view3dCanvas(page)).toBeVisible();
  const box = (await view3dCanvas(page).boundingBox())!;
  // Clear of the floor menu at the top left and the side panel at the top right.
  const clear: Clear = (p) =>
    p.x > box.x + 20 &&
    p.x < box.x + box.width - 360 &&
    p.y > box.y + 70 &&
    p.y < box.y + box.height - 20;
  const input = mouse(page);
  const window = await slideAndWidenWindow(page, input, clear);

  // Escape during a drag drops the preview and keeps the selection.
  const before = (await readFloor(page)).openings[window.id];
  const slide = await gizmoHandleOnPage(page, 'slide');
  await page.mouse.move(slide.x, slide.y);
  await page.mouse.down();
  await page.mouse.move(slide.x + slide.axis!.x * 40, slide.y + slide.axis!.y * 40, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await readFloor(page)).openings[window.id]).toEqual(before);
  expect(await readSelection(page)).toEqual([selected(window)]);

  await moveWallThenOrbit(page, input, clear);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a window and a wall are moved and resized with gizmos in 3D with a finger', async ({
    page,
  }) => {
    await page.goto('/dev/synthetic/small?view=3d');
    await expect(view3dCanvas(page)).toBeVisible();
    const box = (await view3dCanvas(page).boundingBox())!;
    // Below the floor menu and above the bottom sheet that opens for the selection.
    const clear: Clear = (p) =>
      p.x > box.x + 20 &&
      p.x < box.x + box.width - 20 &&
      p.y > box.y + 70 &&
      p.y < box.y + box.height * 0.45;
    const input = await finger(page);
    const window = await slideAndWidenWindow(page, input, clear);

    // A second finger during a drag drops the preview.
    const before = (await readFloor(page)).openings[window.id];
    const slide = await gizmoHandleOnPage(page, 'slide');
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [slide]);
    const to = (i: number) => ({
      x: slide.x + slide.axis!.x * 8 * i,
      y: slide.y + slide.axis!.y * 8 * i,
    });
    for (let i = 1; i <= 5; i++) await touch(cdp, 'touchMove', [to(i)]);
    await touch(cdp, 'touchStart', [to(5), { x: 30, y: 200 }]);
    await touch(cdp, 'touchEnd', []);
    expect((await readFloor(page)).openings[window.id]).toEqual(before);
    expect(await readSelection(page)).toEqual([selected(window)]);

    // A second finger landing on a handle during a pinch joins the pinch instead of grabbing it.
    const top = await gizmoHandleOnPage(page, 'top');
    const spots = [0.15, 0.85].flatMap((fx) =>
      [0.12, 0.3].map((fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })),
    );
    const first = spots.reduce((p, q) => (dist(q, top) > dist(p, top) ? q : p));
    const away = { x: Math.sign(top.x - first.x), y: Math.sign(top.y - first.y) };
    await touch(cdp, 'touchStart', [first]);
    await touch(cdp, 'touchStart', [first, top]);
    for (let i = 1; i <= 8; i++)
      await touch(cdp, 'touchMove', [
        { x: first.x - away.x * 6 * i, y: first.y - away.y * 6 * i },
        { x: top.x + away.x * 6 * i, y: top.y + away.y * 6 * i },
      ]);
    await touch(cdp, 'touchEnd', []);
    expect((await readFloor(page)).openings[window.id]).toEqual(before);
    await expect
      .poll(async () => dist(await gizmoHandleOnPage(page, 'top'), top))
      .toBeGreaterThan(5);
    await input.button('Zooma till allt');

    await moveWallThenOrbit(page, input, clear);
  });
});
