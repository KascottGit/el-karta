import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, readOpenFloor, readSelection, worldToPage, type Pt } from './app-modules';
import { openSynthetic } from './editor';
import { finger, mouse, type Input } from './input';
import { firstOnPage, view3dCanvas, view3dHighlighted } from './view3d';

interface OpeningSnapshot {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'passage';
  offset: number;
  width: number;
}

type DeviceSnapshot =
  | { kind: 'wall'; wallId: string; offset: number }
  | { kind: 'ceiling' | 'floor'; at: Pt }
  | { kind: 'container' };

const readFloor = async (page: Page) => {
  const { walls, openings, devices } = await readOpenFloor<{
    walls: Record<string, { id: string; a: Pt; b: Pt }>;
    openings: Record<string, OpeningSnapshot>;
    devices: Record<string, { placement: DeviceSnapshot }>;
  }>(page, ['walls', 'openings', 'devices']);
  const floorId = await page.evaluate(async (url) => {
    const { editorStore } = (await import(/* @vite-ignore */ url)) as {
      editorStore: { getState(): { floorId: string } };
    };
    return editorStore.getState().floorId;
  }, EDITOR_STORE);
  return {
    floorId,
    walls: Object.values(walls),
    openings: Object.values(openings),
    devices: Object.values(devices).map((d) => d.placement),
  };
};

/**
 * The point along an opening, in plan, farthest from the device markers drawn on top of it (the
 * light switch beside a door), so a 2D tap there picks the opening.
 */
function tapPointOf(
  opening: OpeningSnapshot,
  walls: readonly { id: string; a: Pt; b: Pt }[],
  devices: readonly DeviceSnapshot[],
): Pt {
  const wall = walls.find((w) => w.id === opening.wallId)!;
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  const at = (offset: number) => ({
    x: wall.a.x + ((wall.b.x - wall.a.x) * offset) / length,
    y: wall.a.y + ((wall.b.y - wall.a.y) * offset) / length,
  });
  const clearance = (offset: number) => {
    const p = at(offset);
    return Math.min(
      ...devices.map((d) =>
        d.kind === 'wall'
          ? d.wallId === opening.wallId
            ? Math.abs(d.offset - offset)
            : Infinity
          : d.kind === 'container'
            ? Infinity
            : Math.hypot(d.at.x - p.x, d.at.y - p.y),
      ),
    );
  };
  const offsets = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => opening.offset + opening.width * t);
  return at(offsets.reduce((best, o) => (clearance(o) > clearance(best) ? o : best)));
}

const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const selected = (id: string) => [{ collection: 'openings', id }];

/**
 * The first opening of `kind` with a point to tap in 2D inside the part of the 2D canvas `area`
 * keeps clear, and that point on the page.
 */
async function openingIn2d(
  page: Page,
  kind: OpeningSnapshot['kind'],
  area: (box: { x: number; y: number; width: number; height: number }) => (p: Pt) => boolean,
) {
  const { walls, openings, devices } = await readFloor(page);
  const toPage = await worldToPage(page);
  const inside = area((await page.getByTestId('floor-editor-canvas').boundingBox())!);
  const found = openings
    .filter((o) => o.kind === kind)
    .map((o) => ({ opening: o, at: toPage(tapPointOf(o, walls, devices)) }))
    .find(({ at }) => inside(at));
  expect(found, kind).toBeDefined();
  return found!;
}

/** Taps an opening of `kind` (and `keep`) that the 3D view shows and checks that it is selected. */
async function tapIn3d(
  page: Page,
  input: Input,
  kind: OpeningSnapshot['kind'],
  title: string,
  keep: (opening: OpeningSnapshot) => boolean = () => true,
) {
  await page.keyboard.press('Escape');
  await expect.poll(() => readSelection(page)).toEqual([]);
  const { floorId, openings } = await readFloor(page);
  const { item, at } = await firstOnPage(
    page,
    openings
      .filter((o) => o.kind === kind && keep(o))
      .map((o) => ({ floorId, collection: 'openings' as const, id: o.id })),
  );
  await input.tap(at);
  expect(await readSelection(page), kind).toEqual(selected(item.id));
  await expect(panel(page, title)).toBeVisible();
  await expect.poll(() => view3dHighlighted(page)).toEqual([item]);
  return item;
}

/**
 * Taps a window and a door (one of `doors`) in 3D, turns the door into a passage in the panel, and
 * taps the passage, which is picked though it is not drawn.
 */
async function tapOpeningsIn3d(
  page: Page,
  input: Input,
  touch: boolean,
  doors?: (opening: OpeningSnapshot) => boolean,
) {
  await tapIn3d(page, input, 'window', 'Fönster');
  const door = await tapIn3d(page, input, 'door', 'Dörr', doors);
  const kind = panel(page, 'Dörr').getByRole('button', { name: 'Passage', exact: true });
  await (touch ? kind.tap() : kind.click());
  await expect
    .poll(async () => (await readFloor(page)).openings.find((o) => o.id === door.id)?.kind)
    .toBe('passage');
  await expect(panel(page, 'Passage')).toBeVisible();
  return tapIn3d(page, input, 'passage', 'Passage');
}

test('openings tapped in 2D are selected in 3D and the other way round, side by side', async ({
  page,
}) => {
  await openSynthetic(page, 'small', '?view=split');
  await expect(view3dCanvas(page)).toBeVisible();
  const input = mouse(page);
  const clear = (box: { x: number; y: number; width: number; height: number }) => (p: Pt) =>
    p.x > box.x + 80 &&
    p.x < box.x + box.width - 20 &&
    p.y > box.y + 20 &&
    p.y < box.y + box.height - 20;

  const { floorId } = await readFloor(page);
  const { opening: window, at } = await openingIn2d(page, 'window', clear);
  await input.tap(at);
  expect(await readSelection(page)).toEqual(selected(window.id));
  await expect
    .poll(() => view3dHighlighted(page))
    .toEqual([{ floorId, collection: 'openings', id: window.id }]);

  // A door the 2D view also shows, so the passage it becomes can be tapped there too.
  const { walls, devices } = await readFloor(page);
  const toPage = await worldToPage(page);
  const box = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  const in2d = (o: OpeningSnapshot) => clear(box)(toPage(tapPointOf(o, walls, devices)));
  const passage = await tapOpeningsIn3d(page, input, false, in2d);

  await page.keyboard.press('Escape');
  await expect.poll(() => view3dHighlighted(page)).toEqual([]);
  const { openings } = await readFloor(page);
  await input.tap(
    toPage(
      tapPointOf(
        openings.find((o) => o.id === passage.id)!,
        walls,
        devices,
      ),
    ),
  );
  expect(await readSelection(page)).toEqual(selected(passage.id));
  await expect.poll(() => view3dHighlighted(page)).toEqual([passage]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('openings selected in 2D show in 3D, and a window and a passage tapped in 3D show in 2D', async ({
    page,
  }) => {
    await openSynthetic(page, 'small');
    const input = await finger(page);
    const { floorId } = await readFloor(page);
    // Above the bottom sheet that opens for the selected window.
    const { opening: window, at } = await openingIn2d(
      page,
      'window',
      (box) => (p) =>
        p.x > box.x + 30 &&
        p.x < box.x + box.width - 30 &&
        p.y > box.y + 60 &&
        p.y < box.y + box.height * 0.45,
    );
    await input.tap(at);
    expect(await readSelection(page)).toEqual(selected(window.id));

    await input.button('3D');
    await expect(view3dCanvas(page)).toBeVisible();
    await expect
      .poll(() => view3dHighlighted(page))
      .toEqual([{ floorId, collection: 'openings', id: window.id }]);

    const passage = await tapOpeningsIn3d(page, input, true);

    await input.button('2D');
    await expect(page.getByTestId('floor-editor-canvas')).toBeVisible();
    expect(await readSelection(page)).toEqual(selected(passage.id));
    await expect(panel(page, 'Passage')).toBeVisible();
  });
});
