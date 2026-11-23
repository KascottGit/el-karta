import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { EDITOR_STORE, readOpenFloor, readSelection, worldToPage, type Pt } from './app-modules';
import { openSynthetic } from './editor';
import { itemOnPage, view3dCanvas, view3dHighlighted } from './view3d';

interface Furniture {
  id: string;
  type: string;
  roomId?: string;
  placement: {
    kind: 'floor';
    at: Pt;
    rotation?: number;
    size?: { x: number; y: number; z: number };
  };
}
interface FloorSnapshot {
  walls: Record<string, { a: Pt; b: Pt }>;
  rooms: Record<string, { id: string; polygon: Pt[] }>;
  devices: Record<string, { id: string; placement: { kind: string; at?: Pt } }>;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const toSegment = (p: Pt, a: Pt, b: Pt) => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
};

const inside = (p: Pt, polygon: Pt[]) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      hit = !hit;
  }
  return hit;
};

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ ...p, id })),
  });

async function fingerDrag(cdp: CDPSession, from: Pt, to: Pt) {
  await touch(cdp, 'touchStart', [from]);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, 'touchMove', [
      { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 },
    ]);
  }
  await touch(cdp, 'touchEnd', []);
}

const readDevices = async (page: Page) =>
  (
    await readOpenFloor<{ devices: Record<string, Furniture & { domain: string }> }>(page, [
      'devices',
    ])
  ).devices;

const tapButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).tap();

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('place, move, turn and resize a desk, undo each step, and see it in 3D', async ({
    page,
  }) => {
    const toPage = await openSynthetic(page, 'small');
    const canvas = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
    const { walls, rooms, devices } = await readOpenFloor<FloorSnapshot>(page, [
      'walls',
      'rooms',
      'devices',
    ]);
    const before = new Set(Object.keys(devices));

    // A spot in the top of the view, inside a room and clear of walls and other devices, with
    // room to move the desk a metre to the right.
    const clear = (p: Pt) =>
      Object.values(walls).every((w) => toSegment(p, w.a, w.b) > 0.7) &&
      Object.values(devices).every((d) => !d.placement.at || dist(d.placement.at, p) > 1);
    const spot = Object.values(rooms)
      .flatMap((r) => {
        const xs = r.polygon.map((p) => p.x);
        const ys = r.polygon.map((p) => p.y);
        const out: { roomId: string; at: Pt }[] = [];
        for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 0.25)
          for (let y = Math.min(...ys) + 0.5; y < Math.max(...ys); y += 0.25) {
            const at = { x, y };
            const s = toPage(at);
            if (
              inside(at, r.polygon) &&
              clear(at) &&
              clear({ x: x + 1, y }) &&
              s.x > canvas.x + 40 &&
              s.x < canvas.x + canvas.width - 120 &&
              s.y > canvas.y + 60 &&
              s.y < canvas.y + canvas.height * 0.4
            )
              out.push({ roomId: r.id, at });
          }
        return out;
      })
      .at(0)!;
    expect(spot).toBeDefined();

    // Place.
    await tapButton(page, 'Möbel');
    const toolPanel = page.getByRole('region', { name: 'Ny möbel' });
    await expect(toolPanel).toBeVisible();
    await toolPanel.getByLabel('Typ').selectOption({ label: 'Skrivbord' });
    const at = toPage(spot.at);
    await page.touchscreen.tap(at.x, at.y);
    const placed = Object.values(await readDevices(page)).find((d) => !before.has(d.id))!;
    expect(placed).toMatchObject({
      domain: 'furnishing',
      type: 'desk',
      roomId: spot.roomId,
      placement: { kind: 'floor', rotation: 0, size: { x: 1.4, y: 0.7, z: 0.75 } },
    });
    expect(dist(placed.placement.at, spot.at)).toBeLessThan(0.05);
    expect(await readSelection(page)).toEqual([{ collection: 'devices', id: placed.id }]);
    const desk = async () => (await readDevices(page))[placed.id];

    await tapButton(page, 'Ångra');
    expect(await desk()).toBeUndefined();
    await tapButton(page, 'Gör om');
    expect(await desk()).toBeDefined();
    await page.getByRole('button', { name: 'Markera', exact: true }).tap();
    await page.touchscreen.tap(at.x, at.y);
    expect(await readSelection(page)).toEqual([{ collection: 'devices', id: placed.id }]);

    // Move a metre to the right by dragging the body.
    const view = await worldToPage(page);
    const scale = view({ x: 1, y: 0 }).x - view({ x: 0, y: 0 }).x;
    const cdp = await page.context().newCDPSession(page);
    const grab = view({ x: spot.at.x + 0.3, y: spot.at.y });
    await fingerDrag(cdp, grab, { x: grab.x + scale, y: grab.y });
    expect((await desk())!.placement.at.x).toBeCloseTo(spot.at.x + 1, 1);
    expect((await desk())!.placement.at.y).toBeCloseTo(spot.at.y, 1);
    await tapButton(page, 'Ångra');
    expect((await desk())!.placement.at.x).toBeCloseTo(spot.at.x, 5);
    await tapButton(page, 'Gör om');
    const moved = (await desk())!.placement.at;
    expect(moved.x).toBeCloseTo(spot.at.x + 1, 1);

    // Turn a quarter clockwise with the knob behind the desk.
    const centre = view(moved);
    const knob = { x: centre.x, y: centre.y - 0.35 * scale - 28 };
    await fingerDrag(cdp, knob, { x: centre.x + 120, y: centre.y + 2 });
    expect((await desk())!.placement.rotation).toBe(90);
    await tapButton(page, 'Ångra');
    expect((await desk())!.placement.rotation).toBe(0);
    await tapButton(page, 'Gör om');
    expect((await desk())!.placement.rotation).toBe(90);

    // Resize in the panel.
    const panel = page.getByRole('region', { name: 'Möbel', exact: true });
    await expect(panel).toContainText('Skrivbord');
    const width = panel.getByLabel('Bredd');
    await expect(width).toHaveValue('1,4');
    await width.fill('1,8');
    await width.press('Enter');
    expect((await desk())!.placement.size).toEqual({ x: 1.8, y: 0.7, z: 0.75 });
    await tapButton(page, 'Ångra');
    expect((await desk())!.placement.size).toEqual({ x: 1.4, y: 0.7, z: 0.75 });
    await expect(width).toHaveValue('1,4');
    await tapButton(page, 'Gör om');
    await expect(width).toHaveValue('1,8');

    // Unselected, the desk has no handles, so a finger drag across it pans the view.
    await selectItems(page, []);
    const panFrom = view(moved);
    const viewportBefore = await readViewport(page);
    await fingerDrag(cdp, panFrom, { x: panFrom.x + 80, y: panFrom.y + 40 });
    expect((await desk())!.placement.at).toEqual(moved);
    const viewportAfter = await readViewport(page);
    expect(viewportAfter.x - viewportBefore.x).toBeCloseTo(80, 0);
    expect(viewportAfter.y - viewportBefore.y).toBeCloseTo(40, 0);
    await selectItems(page, [{ collection: 'devices', id: placed.id }]);

    // The desk stays selected in 3D, where it is a box that a tap reaches.
    await tapButton(page, '3D');
    await expect(view3dCanvas(page)).toBeVisible();
    const item = {
      floorId: await openFloorId(page),
      collection: 'devices' as const,
      id: placed.id,
    };
    await expect.poll(() => view3dHighlighted(page)).toEqual([item]);
    expect(await itemOnPage(page, item)).toBeTruthy();
  });
});

const openFloorId = (page: Page) =>
  page.evaluate(async (url) => {
    const { editorStore } = (await import(/* @vite-ignore */ url)) as {
      editorStore: { getState(): { floorId: string } };
    };
    return editorStore.getState().floorId;
  }, EDITOR_STORE);

const readViewport = (page: Page) =>
  page.evaluate(async (url) => {
    const { editorStore } = (await import(/* @vite-ignore */ url)) as {
      editorStore: { getState(): { viewport: { x: number; y: number } } };
    };
    return editorStore.getState().viewport;
  }, EDITOR_STORE);

const selectItems = (page: Page, items: { collection: string; id: string }[]) =>
  page.evaluate(
    async ([url, selection]) => {
      const { editorStore } = (await import(/* @vite-ignore */ url)) as {
        editorStore: { getState(): { select(items: unknown[]): void } };
      };
      editorStore.getState().select(selection);
    },
    [EDITOR_STORE, items] as const,
  );
