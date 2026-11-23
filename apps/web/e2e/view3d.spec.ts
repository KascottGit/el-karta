import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, MODEL_STORE, readSelection, type Pt } from './app-modules';
import { openSynthetic } from './editor';
import { touch } from './input';
import {
  firstOnPage,
  itemOnPage,
  view3dBuilds,
  view3dCanvas,
  view3dHighlighted,
  type View3dItem,
} from './view3d';

interface Wall {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
}
interface FloorSnapshot {
  id: string;
  walls: Record<string, Wall>;
  rooms: Record<string, { id: string; polygon: Pt[] }>;
  openings: Record<string, { wallId: string; offset: number; width: number }>;
  devices: Record<
    string,
    {
      id: string;
      type: string;
      placement:
        | { kind: 'wall'; wallId: string; offset: number; side: 'left' | 'right' }
        | { kind: 'ceiling' | 'floor'; at: Pt }
        | { kind: 'container' };
    }
  >;
}

/** Every floor of the project and the id of the one open in the editor. */
const readFloors = (page: Page) =>
  page.evaluate(
    async ([modelUrl, editorUrl]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl)) as {
        modelStore: {
          getState(): {
            model: { floors: Record<string, { id: string; data: Omit<FloorSnapshot, 'id'> }> };
          };
        };
      };
      const { editorStore } = (await import(/* @vite-ignore */ editorUrl)) as {
        editorStore: { getState(): { floorId: string } };
      };
      const floors = Object.values(modelStore.getState().model.floors).map(
        ({ id, data: { walls, rooms, openings, devices } }) => ({
          id,
          walls,
          rooms,
          openings,
          devices,
        }),
      );
      return { open: editorStore.getState().floorId, floors };
    },
    [MODEL_STORE, EDITOR_STORE] as const,
  );

async function openFloorData(page: Page) {
  const { open, floors } = await readFloors(page);
  return { floor: floors.find((f) => f.id === open)!, others: floors.filter((f) => f.id !== open) };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Where each device's marker is drawn in plan (the wall face for wall devices). */
function markPositions(floor: FloorSnapshot): { id: string; at: Pt }[] {
  return Object.values(floor.devices).flatMap((device) => {
    const { placement } = device;
    if (placement.kind === 'container') return [];
    if (placement.kind !== 'wall') return [{ id: device.id, at: placement.at }];
    const wall = floor.walls[placement.wallId];
    if (!wall) return [];
    const length = dist(wall.a, wall.b);
    const dx = (wall.b.x - wall.a.x) / length;
    const dy = (wall.b.y - wall.a.y) / length;
    const toFace = ((placement.side === 'left' ? 1 : -1) * wall.thickness) / 2;
    return [
      {
        id: device.id,
        at: {
          x: wall.a.x + dx * placement.offset + dy * toFace,
          y: wall.a.y + dy * placement.offset - dx * toFace,
        },
      },
    ];
  });
}

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

const toSegment = (p: Pt, a: Pt, b: Pt) => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
};

/**
 * Points in plan where a 2D tap selects a wall, a room and a device: clear of other markers,
 * openings and walls, and inside `visible`.
 */
function tapTargets(floor: FloorSnapshot, visible: (p: Pt) => boolean) {
  const marks = markPositions(floor);
  const walls = Object.values(floor.walls);
  const clearOfMarks = (p: Pt, except?: string) =>
    marks.every((m) => m.id === except || dist(m.at, p) > 0.8);

  const wall = walls
    .flatMap((w) =>
      [0.3, 0.5, 0.7].map((t) => {
        const offset = dist(w.a, w.b) * t;
        const at = { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t };
        const clearOfOpenings = Object.values(floor.openings).every(
          (o) => o.wallId !== w.id || o.offset > offset + 0.5 || o.offset + o.width < offset - 0.5,
        );
        return { id: w.id, at, ok: clearOfOpenings && clearOfMarks(at) && visible(at) };
      }),
    )
    .find((c) => c.ok)!;

  const room = Object.values(floor.rooms)
    .flatMap((r) => {
      const xs = r.polygon.map((p) => p.x);
      const ys = r.polygon.map((p) => p.y);
      const out = [];
      for (let x = Math.min(...xs) + 0.6; x < Math.max(...xs); x += 0.5)
        for (let y = Math.min(...ys) + 0.6; y < Math.max(...ys); y += 0.5) {
          const at = { x, y };
          const ok =
            inside(at, r.polygon) &&
            walls.every((w) => toSegment(at, w.a, w.b) > 0.6) &&
            clearOfMarks(at) &&
            visible(at);
          if (ok) out.push({ id: r.id, at });
        }
      return out;
    })
    .at(0)!;

  const device = marks.find(
    (m) =>
      visible(m.at) &&
      clearOfMarks(m.at, m.id) &&
      floor.devices[m.id]!.placement.kind === 'wall' &&
      floor.devices[m.id]!.type === 'outlet',
  )!;

  return { wall, room, device };
}

const item = (floorId: string, collection: View3dItem['collection'], id: string) => ({
  floorId,
  collection,
  id,
});
const selected = (i: View3dItem) => [{ collection: i.collection, id: i.id }];

/** The region of each item's side panel. */
const panelOf = (page: Page, collection: View3dItem['collection']) =>
  page.getByRole('region', {
    name: { walls: 'Vägg', rooms: 'Rum', devices: 'Enhet' }[collection as string] ?? '',
    exact: true,
  });

/** The small synthetic project in 3D only. */
async function open3d(page: Page) {
  await page.goto('/dev/synthetic/small?view=3d');
  await expect(view3dCanvas(page)).toBeVisible();
}

async function showAllFloorsExploded(page: Page) {
  await page.getByRole('button', { name: 'Våningar' }).click();
  await page.getByRole('radio', { name: 'Alla våningar' }).check();
  await page.getByRole('checkbox', { name: 'Isärdragen' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zooma till allt' }).click();
}

test('the 3D view is a separate chunk and loads only when opened', async ({ page }) => {
  const three: string[] = [];
  page.on('request', (r) => {
    if (/node_modules\/.*three/.test(r.url())) three.push(r.url());
  });
  await openSynthetic(page, 'small');
  await page.waitForTimeout(500);
  expect(three).toEqual([]);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(view3dCanvas(page)).toBeVisible();
  await expect(page).toHaveURL(/view=3d/);
  expect(three.length).toBeGreaterThan(0);
  await expect(page.getByTestId('floor-editor-canvas')).toHaveCount(0);
});

test('items selected in 2D are selected in 3D and the other way round, side by side', async ({
  page,
}) => {
  const toPage = await openSynthetic(page, 'small', '?view=split');
  await expect(view3dCanvas(page)).toBeVisible();
  const canvas2d = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  const { floor } = await openFloorData(page);
  const visible = (p: Pt) => {
    const s = toPage(p);
    return (
      s.x > canvas2d.x + 20 &&
      s.x < canvas2d.x + canvas2d.width - 20 &&
      s.y > canvas2d.y + 20 &&
      s.y < canvas2d.y + canvas2d.height - 20
    );
  };
  const targets = tapTargets(floor, visible);
  const items = [
    { ...item(floor.id, 'walls', targets.wall.id), at: targets.wall.at },
    { ...item(floor.id, 'rooms', targets.room.id), at: targets.room.at },
    { ...item(floor.id, 'devices', targets.device.id), at: targets.device.at },
  ];
  await itemOnPage(page, items[0]!);
  const builds = await view3dBuilds(page);
  expect(builds[floor.id]).toBe(1);

  for (const { at, ...target } of items) {
    const s = toPage(at);
    await page.mouse.click(s.x, s.y);
    expect(await readSelection(page)).toEqual(selected(target));
    await expect.poll(() => view3dHighlighted(page)).toEqual([target]);
  }

  for (const { floorId, collection, id } of items) {
    const target = { floorId, collection, id };
    await page.keyboard.press('Escape');
    await expect.poll(() => view3dHighlighted(page)).toEqual([]);
    const at = await itemOnPage(page, target);
    await page.mouse.click(at.x, at.y);
    expect(await readSelection(page), target.collection).toEqual(selected(target));
    await expect(panelOf(page, target.collection)).toBeVisible();
  }

  // A tap on empty space clears the selection.
  const box = (await view3dCanvas(page).boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  expect(await readSelection(page)).toEqual([]);
  expect(await view3dBuilds(page)).toEqual(builds);
});

test('a mouse drag in 3D orbits the view and does not select', async ({ page }) => {
  await open3d(page);
  const { floor } = await openFloorData(page);
  const { item: target, at } = await firstOnPage(
    page,
    Object.keys(floor.walls).map((id) => item(floor.id, 'walls', id)),
  );
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 30, { steps: 10 });
  await page.mouse.up();
  expect(await readSelection(page)).toEqual([]);
  await expect.poll(async () => itemOnPage(page, target).catch(() => null)).not.toEqual(at);
});

test('the fitted view follows a resize until the camera is moved', async ({ page }) => {
  await open3d(page);
  const { floor } = await openFloorData(page);
  const walls = Object.values(floor.walls);
  // The outermost walls on the left and right, which a narrower view would cut off unfitted.
  const [left, right] = [
    walls.reduce((p, q) => (Math.max(q.a.x, q.b.x) < Math.max(p.a.x, p.b.x) ? q : p)),
    walls.reduce((p, q) => (Math.min(q.a.x, q.b.x) > Math.min(p.a.x, p.b.x) ? q : p)),
  ];
  const visible = (wall: Wall) =>
    page.evaluate(
      (i) => window.__view3d?.screenPosition(i) ?? null,
      item(floor.id, 'walls', wall.id),
    );
  await itemOnPage(page, item(floor.id, 'walls', left.id));

  await page.setViewportSize({ width: 520, height: 720 });
  await expect.poll(() => visible(left)).not.toBeNull();
  await expect.poll(() => visible(right)).not.toBeNull();

  const box = (await view3dCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -200);
  await expect.poll(() => visible(left)).toBeNull();
  // Zoomed in by the person, so a resize keeps their view instead of fitting the floor again.
  await page.setViewportSize({ width: 560, height: 720 });
  await page.waitForTimeout(300);
  expect(await visible(left)).toBeNull();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('3D replaces the canvas and shares the selection and the side panel with 2D', async ({
    page,
  }) => {
    const toPage = await openSynthetic(page, 'small');
    await expect(page.getByRole('button', { name: '2D + 3D' })).toBeHidden();
    const canvas2d = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
    const { floor } = await openFloorData(page);
    const { device } = tapTargets(floor, (p) => {
      const s = toPage(p);
      return (
        s.x > canvas2d.x + 20 &&
        s.x < canvas2d.x + canvas2d.width - 20 &&
        s.y > canvas2d.y + 20 &&
        s.y < canvas2d.y + canvas2d.height * 0.4
      );
    });
    const at2d = toPage(device.at);
    await page.touchscreen.tap(at2d.x, at2d.y);
    const deviceItem = item(floor.id, 'devices', device.id);
    expect(await readSelection(page)).toEqual(selected(deviceItem));

    await page.getByRole('button', { name: '3D', exact: true }).tap();
    await expect(view3dCanvas(page)).toBeVisible();
    await expect(page.getByTestId('floor-editor-canvas')).toHaveCount(0);
    await expect.poll(() => view3dHighlighted(page)).toEqual([deviceItem]);
    await expect(panelOf(page, 'devices')).toBeVisible();
    const builds = await view3dBuilds(page);

    // The panel sheet covers the lower part of the view, so each tap starts with no selection.
    for (const collection of ['walls', 'rooms', 'devices'] as const) {
      await page.keyboard.press('Escape');
      await expect(panelOf(page, 'devices')).toBeHidden();
      const { item: target, at } = await firstOnPage(
        page,
        Object.keys(floor[collection]).map((id) => item(floor.id, collection, id)),
      );
      await page.touchscreen.tap(at.x, at.y);
      expect(await readSelection(page), collection).toEqual(selected(target));
      await expect(panelOf(page, collection)).toBeVisible();
    }

    // Back in 2D, the item tapped in 3D is still selected.
    const [last] = await readSelection(page);
    await page.getByRole('button', { name: '2D', exact: true }).tap();
    await expect(page.getByTestId('floor-editor-canvas')).toBeVisible();
    expect(await readSelection(page)).toEqual([last]);
    await expect(panelOf(page, 'devices')).toBeVisible();
    expect(builds[floor.id]).toBe(1);
  });

  test('a finger drag orbits without selecting, and a tap on another floor opens it', async ({
    page,
  }) => {
    await open3d(page);
    const { floor, others } = await openFloorData(page);
    const other = others[0]!;
    const cdp = await page.context().newCDPSession(page);

    const { item: wall, at } = await firstOnPage(
      page,
      Object.keys(floor.walls).map((id) => item(floor.id, 'walls', id)),
    );
    await touch(cdp, 'touchStart', [at]);
    for (let i = 1; i <= 10; i++) await touch(cdp, 'touchMove', [{ x: at.x + 8 * i, y: at.y }]);
    await touch(cdp, 'touchEnd', []);
    expect(await readSelection(page)).toEqual([]);
    await expect.poll(async () => itemOnPage(page, wall).catch(() => null)).not.toEqual(at);

    await showAllFloorsExploded(page);
    const builds = await view3dBuilds(page);
    const { item: target, at: there } = await firstOnPage(page, [
      ...Object.keys(other.rooms).map((id) => item(other.id, 'rooms', id)),
      ...Object.keys(other.walls).map((id) => item(other.id, 'walls', id)),
    ]);
    await page.touchscreen.tap(there.x, there.y);

    await expect(page).toHaveURL(new RegExp(`floor=${other.id}`));
    await expect(page).toHaveURL(/view=3d/);
    expect((await openFloorData(page)).floor.id).toBe(other.id);
    expect(await readSelection(page)).toEqual(selected(target));
    await expect(panelOf(page, target.collection)).toBeVisible();
    await expect.poll(() => view3dHighlighted(page)).toEqual([target]);
    // Nothing changed in the model, so no floor was rebuilt.
    expect(await view3dBuilds(page)).toEqual(builds);
    // The camera stayed put: the item is where it was tapped.
    const after = await itemOnPage(page, target);
    expect(Math.hypot(after.x - there.x, after.y - there.y)).toBeLessThan(40);
  });
});

test('switching floors keeps the view mode', async ({ page }) => {
  await open3d(page);
  const { others } = await openFloorData(page);
  await page.getByLabel('Våning', { exact: true }).selectOption(others[0]!.id);
  await expect(page).toHaveURL(new RegExp(`floor=${others[0]!.id}`));
  await expect(page).toHaveURL(/view=3d/);
  await expect(view3dCanvas(page)).toBeVisible();
  await expect(page.getByTestId('floor-editor-canvas')).toHaveCount(0);
});
