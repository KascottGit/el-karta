import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, readOpenFloor, readSelection, worldToPage, type Pt } from './app-modules';
import { openSynthetic } from './editor';
import { deviceAt, type Device, type Wall } from './devices-fixtures';
import { fingerDrag } from './input';
import { itemOnPage, view3dCanvas } from './view3d';

interface Room {
  id: string;
  polygon: Pt[];
}
interface FloorSnapshot {
  walls: Record<string, Wall>;
  rooms: Record<string, Room>;
  devices: Record<string, Device>;
}

const PX_PER_METRE = 60;

const add = (p: Pt, q: Pt, k = 1) => ({ x: p.x + q.x * k, y: p.y + q.y * k });
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

/** Zooms to `PX_PER_METRE` with `at` a quarter of the way down the canvas, clear of the sheet. */
const viewAt = (page: Page, at: Pt) =>
  page.evaluate(
    async ([url, point, scale]) => {
      const { editorStore } = (await import(/* @vite-ignore */ url)) as {
        editorStore: {
          getState(): {
            size: { width: number; height: number };
            setViewport(v: { x: number; y: number; scale: number }): void;
          };
        };
      };
      const editor = editorStore.getState();
      editor.setViewport({
        x: editor.size.width / 2 - point.x * scale,
        y: editor.size.height / 4 - point.y * scale,
        scale,
      });
    },
    [EDITOR_STORE, at, PX_PER_METRE] as const,
  );

/**
 * A wall facing into a room towards the plan's bottom edge, and two points 1.2 m apart on that
 * face, clear of other walls and devices, with room for a ceiling light a metre in front of the
 * second.
 */
function findWall({ walls, rooms, devices }: FloorSnapshot) {
  const marks = Object.values(devices).flatMap((d) => deviceAt(walls, d) ?? []);
  for (const wall of Object.values(walls)) {
    const length = dist(wall.a, wall.b);
    const dir = { x: (wall.b.x - wall.a.x) / length, y: (wall.b.y - wall.a.y) / length };
    const mid = add(wall.a, dir, length / 2);
    for (const [side, sign] of [
      ['left', 1],
      ['right', -1],
    ] as const) {
      // Left of a→b with y down.
      const normal = { x: dir.y * sign, y: -dir.x * sign };
      // Facing the 3D camera, which looks from the plan's bottom edge, across a room deep enough
      // that its far wall does not hide the outlet.
      if (normal.y < 0.7) continue;
      const face = (offset: number) => add(add(wall.a, dir, offset), normal, wall.thickness / 2);
      const clearOfDevices = (p: Pt) => marks.every((m) => dist(m, p) > 0.4);
      const clear = (p: Pt) =>
        clearOfDevices(p) &&
        Object.values(walls).every((w) => w.id === wall.id || toSegment(p, w.a, w.b) > 0.6);
      for (let start = 0.7; start + 1.9 <= length; start += 0.1) {
        const end = start + 1.2;
        const light = add(face(end), normal, 1);
        const room = Object.values(rooms).find(
          (r) =>
            inside(add(face(start), normal, 0.1), r.polygon) &&
            inside(add(face(end), normal, 3), r.polygon),
        );
        if (room && clear(face(start)) && clear(face(end)) && clearOfDevices(light))
          return { wall, side, normal, face, room, mid, start, end, light };
      }
    }
  }
  return null;
}

const readDevices = async (page: Page) =>
  (await readOpenFloor<Pick<FloorSnapshot, 'devices'>>(page, ['devices'])).devices;

const tapButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).tap();

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('place an outlet and a ceiling light, move the outlet along its wall, delete, undo, see it in 3D', async ({
    page,
  }) => {
    await openSynthetic(page, 'small');
    const floor = await readOpenFloor<FloorSnapshot>(page, ['walls', 'rooms', 'devices']);
    const before = new Set(Object.keys(floor.devices));
    const added = async () =>
      Object.values(await readDevices(page)).filter((d) => !before.has(d.id));
    const spot = findWall(floor)!;
    expect(spot).not.toBeNull();
    await viewAt(page, spot.mid);
    let toPage = await worldToPage(page);

    // An outlet: the tool, then a tap just off the wall face.
    await tapButton(page, 'Elenhet');
    const toolPanel = page.getByRole('region', { name: 'Ny elenhet' });
    await expect(toolPanel.getByLabel('Typ')).toHaveValue('outlet');
    const tapAt = toPage(add(spot.face(spot.start), spot.normal, 0.1));
    await page.touchscreen.tap(tapAt.x, tapAt.y);
    const [outlet] = await added();
    expect(outlet).toMatchObject({
      domain: 'power',
      type: 'outlet',
      roomId: spot.room.id,
      placement: { kind: 'wall', wallId: spot.wall.id, side: spot.side, height: 0.25 },
    });
    const offsetOf = (d: Device | undefined) =>
      d?.placement.kind === 'wall' ? d.placement.offset : NaN;
    expect(offsetOf(outlet)).toBeCloseTo(spot.start, 1);
    expect(await readSelection(page)).toEqual([{ collection: 'devices', id: outlet!.id }]);

    // A ceiling light: the type, then a tap in the room.
    await toolPanel.getByLabel('Typ').selectOption({ label: 'Taklampa' });
    const lightTap = toPage(spot.light);
    await page.touchscreen.tap(lightTap.x, lightTap.y);
    const light = (await added()).find((d) => d.type === 'ceiling_light');
    expect(light).toMatchObject({
      domain: 'power',
      roomId: spot.room.id,
      placement: { kind: 'ceiling', roomId: spot.room.id },
    });

    // Select the outlet and drag it 1.2 m along its wall.
    const marker = toPage(spot.face(spot.start));
    await page.touchscreen.tap(marker.x, marker.y);
    expect(await readSelection(page)).toEqual([{ collection: 'devices', id: outlet!.id }]);
    await expect(page.getByRole('region', { name: 'Elenhet', exact: true })).toBeVisible();
    toPage = await worldToPage(page);
    const from = toPage(spot.face(spot.start));
    const to = toPage(spot.face(spot.end));
    const cdp = await page.context().newCDPSession(page);
    await fingerDrag(cdp, from, to);
    const moved = (await readDevices(page))[outlet!.id];
    expect(moved?.placement).toMatchObject({ wallId: spot.wall.id, side: spot.side });
    expect(offsetOf(moved)).toBeCloseTo(spot.end, 1);

    // Delete, and undo.
    await tapButton(page, 'Ta bort markerade');
    expect((await readDevices(page))[outlet!.id]).toBeUndefined();
    await tapButton(page, 'Ångra');
    expect(offsetOf((await readDevices(page))[outlet!.id])).toBeCloseTo(spot.end, 1);

    // Raise it in the panel, and see it in 3D.
    const at = (await worldToPage(page))(spot.face(spot.end));
    await page.touchscreen.tap(at.x, at.y);
    const panel = page.getByRole('region', { name: 'Elenhet', exact: true });
    const height = panel.getByLabel('Höjd över golv');
    await expect(height).toHaveValue('0,25');
    await height.fill('1,2');
    await height.press('Enter');
    expect((await readDevices(page))[outlet!.id]?.placement).toMatchObject({ height: 1.2 });
    await tapButton(page, '3D');
    await expect(view3dCanvas(page)).toBeVisible();
    const floorId = await page.evaluate(async (url) => {
      const { editorStore } = (await import(/* @vite-ignore */ url)) as {
        editorStore: { getState(): { floorId: string } };
      };
      return editorStore.getState().floorId;
    }, EDITOR_STORE);
    expect(await itemOnPage(page, { floorId, collection: 'devices', id: outlet!.id })).toBeTruthy();
  });
});
