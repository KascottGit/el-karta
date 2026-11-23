import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, MODEL_STORE, readOpenFloor, readSelection, type Pt } from './app-modules';
import { openSynthetic } from './editor';

interface Device {
  id: string;
  label: string;
  type: string;
  placement:
    | { kind: 'wall'; wallId: string; offset: number; side: 'left' | 'right' }
    | { kind: 'ceiling' | 'floor'; at: Pt }
    | { kind: 'container' };
}
interface Wall {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
}
interface FloorSnapshot {
  walls: Record<string, Wall>;
  devices: Record<string, Device>;
}

/** The point on the wall face where a wall device's marker is drawn (left is towards -y for +x). */
function wallFace(wall: Wall, offset: number, side: 'left' | 'right'): Pt {
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  const dx = (wall.b.x - wall.a.x) / length;
  const dy = (wall.b.y - wall.a.y) / length;
  const toFace = ((side === 'left' ? 1 : -1) * wall.thickness) / 2;
  return { x: wall.a.x + dx * offset + dy * toFace, y: wall.a.y + dy * offset - dx * toFace };
}

/** Removes a wall the way a remote change would, leaving the devices on it in place. */
const removeWall = (page: Page, wallId: string) =>
  page.evaluate(
    async ([modelUrl, editorUrl, id]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl)) as {
        modelStore: {
          getState(): {
            apply(edit: (draft: { floors: Record<string, { data: FloorSnapshot }> }) => void): void;
          };
        };
      };
      const { editorStore } = (await import(/* @vite-ignore */ editorUrl)) as {
        editorStore: { getState(): { floorId: string } };
      };
      const floorId = editorStore.getState().floorId;
      modelStore.getState().apply((draft) => {
        delete draft.floors[floorId]!.data.walls[id];
      });
    },
    [MODEL_STORE, EDITOR_STORE, wallId] as const,
  );

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a finger tap on a device marker selects it and shows its panel and issues', async ({
    page,
  }) => {
    const toPage = await openSynthetic(page, 'small');
    const canvas = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
    const { walls, devices } = await readOpenFloor<FloorSnapshot>(page, ['walls', 'devices']);

    const marks = Object.values(devices).flatMap((device) => {
      const { placement } = device;
      if (placement.kind === 'container') return [];
      const wall = placement.kind === 'wall' ? walls[placement.wallId] : undefined;
      const at =
        placement.kind === 'wall'
          ? wallFace(wall!, placement.offset, placement.side)
          : placement.at;
      return [{ device, wall, screen: toPage(at) }];
    });
    // An outlet in the top of the view, clear of the side panel sheet and of other markers.
    const target = marks.find(
      ({ device, wall, screen }) =>
        device.type === 'outlet' &&
        wall &&
        screen.x > canvas.x + 20 &&
        screen.x < canvas.x + canvas.width - 20 &&
        screen.y > canvas.y + 20 &&
        screen.y < canvas.y + canvas.height * 0.4 &&
        marks.every(
          (other) =>
            other.device === device ||
            Math.hypot(other.screen.x - screen.x, other.screen.y - screen.y) > 24,
        ),
    )!;
    expect(target).toBeDefined();

    await page.touchscreen.tap(target.screen.x, target.screen.y);
    expect(await readSelection(page)).toEqual([{ collection: 'devices', id: target.device.id }]);
    const panel = page.getByRole('region', { name: 'Enhet', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(target.device.label);
    await expect(panel).toContainText('Vägguttag');

    await removeWall(page, target.wall!.id);
    await expect(panel).toContainText('Väggen som enheten sitter på finns inte.');
    await expect(panel).toContainText('Enheten syns inte på ritningen');

    await page.getByRole('button', { name: 'Ta bort markerade' }).tap();
    await expect(panel).toBeHidden();
    const after = await readOpenFloor<FloorSnapshot>(page, ['devices']);
    expect(after.devices[target.device.id]).toBeUndefined();
  });
});
