import { expect, test, type Page } from '@playwright/test';
import { readOpenFloor, readSelection, type Pt } from './app-modules';
import { openSynthetic } from './editor';

interface AreaSnapshot {
  id: string;
  name: string;
  polygon: Pt[];
}

interface AreasSnapshot {
  rooms: AreaSnapshot[];
  zones: AreaSnapshot[];
  selection: { collection: string; id: string }[];
}

/** The rooms and zones of the floor open in the editor, and the selection. */
const readAreas = async (page: Page): Promise<AreasSnapshot> => {
  type Areas = Record<string, AreaSnapshot>;
  const { rooms, zones } = await readOpenFloor<{ rooms: Areas; zones: Areas }>(page, [
    'rooms',
    'zones',
  ]);
  return {
    rooms: Object.values(rooms),
    zones: Object.values(zones),
    selection: await readSelection(page),
  };
};

const centre = (polygon: Pt[]) => ({
  x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
  y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
});

/** The room nearest the top of the plan, so the side panel sheet on a phone does not cover it. */
const topRoom = (areas: AreasSnapshot) =>
  [...areas.rooms].sort((a, b) => centre(a.polygon).y - centre(b.polygon).y)[0]!;

test('filling a room between walls selects it; dragging a corner is undone in one step', async ({
  page,
}) => {
  const toPage = await openSynthetic(page, 'small');
  const before = await readAreas(page);
  const room = topRoom(before);
  const inside = toPage(centre(room.polygon));

  // Remove the synthetic room so the fill makes a new one there.
  await page.mouse.click(inside.x, inside.y);
  await expect
    .poll(async () => (await readAreas(page)).selection)
    .toEqual([{ collection: 'rooms', id: room.id }]);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await readAreas(page)).rooms.length).toBe(before.rooms.length - 1);

  await page.getByRole('button', { name: 'Fyll rum mellan väggar' }).click();
  await page.mouse.click(inside.x, inside.y);
  const filled = await readAreas(page);
  expect(filled.rooms).toHaveLength(before.rooms.length);
  const added = filled.rooms.find(
    (r) => r.id !== room.id && !before.rooms.some((b) => b.id === r.id),
  )!;
  expect(added.name).toBe('Rum 1');
  expect(added.polygon).toHaveLength(4);
  expect(filled.selection).toEqual([{ collection: 'rooms', id: added.id }]);
  await expect(page.getByLabel('Namn')).toHaveValue('Rum 1');

  const corner = added.polygon[0]!;
  const from = toPage(corner);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 40, { steps: 8 });
  await page.mouse.up();
  const dragged = (await readAreas(page)).rooms.find((r) => r.id === added.id)!;
  expect(dragged.polygon).not.toEqual(added.polygon);
  expect(dragged.polygon).toHaveLength(4);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await readAreas(page)).rooms.find((r) => r.id === added.id)?.polygon)
    .toEqual(added.polygon);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a zone is drawn with finger taps and closed on its first corner', async ({ page }) => {
    const toPage = await openSynthetic(page, 'small');
    const before = await readAreas(page);
    const c = centre(topRoom(before).polygon);
    const corners = [
      { x: c.x - 1, y: c.y - 1 },
      { x: c.x + 1, y: c.y - 1 },
      { x: c.x + 1, y: c.y + 1 },
      { x: c.x - 1, y: c.y + 1 },
    ];

    await page.getByRole('button', { name: 'Rita zon' }).tap();
    for (const corner of [...corners, corners[0]!]) {
      const at = toPage(corner);
      await page.touchscreen.tap(at.x, at.y);
    }

    await expect
      .poll(async () => (await readAreas(page)).zones.length)
      .toBe(before.zones.length + 1);
    const after = await readAreas(page);
    const zone = after.zones.find((z) => !before.zones.some((b) => b.id === z.id))!;
    expect(zone.name).toMatch(/^Zon \d+$/);
    expect(zone.polygon).toHaveLength(4);
    zone.polygon.forEach((p, i) => {
      expect(p.x).toBeCloseTo(corners[i]!.x, 1);
      expect(p.y).toBeCloseTo(corners[i]!.y, 1);
    });
    expect(after.selection).toEqual([{ collection: 'zones', id: zone.id }]);
  });
});
