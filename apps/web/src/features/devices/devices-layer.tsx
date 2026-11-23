import type { Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Shape } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '@/features/floorplan/editor-store';
import { createCuller } from '@/features/floorplan/canvas/culling';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { selectable } from '@/features/floorplan/canvas/hit';
import { selectedIds } from '@/features/floorplan/canvas/selection';
import { useRenderWindow } from '@/features/floorplan/canvas/use-render-window';
import { deviceAppearance, type MarkerShape } from './appearance';
import { useDraggedDevice } from './device-drag';
import { deviceColor, deviceIssues, type DeviceIssue } from './device-issues';
import { deviceMarks, markBounds, type DeviceMark } from './device-marks';
import { Footprint, Markers } from './device-shapes';
import { markerStyle, SELECTED_MARKER_PX, type MarkerGroup } from './marker-style';
import { markerSubpath } from './marker-path';

const cullMarks = createCuller(markBounds);
const NO_MARKS: readonly DeviceMark[] = [];
const NO_ISSUES: ReadonlyMap<Id, readonly DeviceIssue[]> = new Map();
// Any colour: hit shapes are drawn in their hit colour, never on screen.
const HIT_FILL = '#000000';

/**
 * Every device with a position as a small marker of constant screen size, and devices drawn at
 * their own size as their footprint. Flagged devices take the colour of their worst issue.
 *
 * One shape paints all markers from cached sprites, since a shape and path per marker made
 * panning the large project about three times slower; each device has a hit-only shape for
 * selection.
 */
export function DevicesLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const data = floor?.data;
  const { rect: view } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  const marks = useMemo(() => (data ? deviceMarks(data) : undefined), [data]);
  const issues = useMemo(() => (floor ? deviceIssues(floor) : NO_ISSUES), [floor]);
  const culled = useMemo(() => (marks ? cullMarks(marks, view) : NO_MARKS), [marks, view]);
  // The device being dragged is drawn by `DraggedDevice` on the overlays meanwhile.
  const dragged = useDraggedDevice(ctx.floorId)?.id;
  const visible = useMemo(
    () => (dragged === undefined ? culled : culled.filter((m) => m.device.id !== dragged)),
    [culled, dragged],
  );
  const selected = useMemo(() => selectedIds(selection, 'devices'), [selection]);

  const colorOf = useMemo(() => (mark: DeviceMark) => deviceColor(issues, mark.device), [issues]);

  const groups = useMemo(() => {
    const byKey = new Map<string, MarkerGroup>();
    const add = (mark: DeviceMark, look: 'plain' | 'selected') => {
      const shape = deviceAppearance(mark.device).shape;
      const fill = colorOf(mark);
      const key = `${look}|${shape}|${fill}`;
      const group = byKey.get(key);
      if (group) group.at.push(mark.at);
      else byKey.set(key, { style: markerStyle(shape, fill, look), at: [mark.at] });
    };
    const chosen: DeviceMark[] = [];
    for (const mark of visible) {
      if (mark.footprint) continue;
      if (selected.has(mark.device.id)) chosen.push(mark);
      else add(mark, 'plain');
    }
    // Selected markers come last, so they are drawn on top.
    for (const mark of chosen) add(mark, 'selected');
    return [...byKey.values()];
  }, [visible, selected, colorOf]);

  // Memoized like `WallsLayer`'s, for the urgent render after a render window change.
  return useMemo(
    () => (
      <>
        {visible.map((mark) =>
          mark.footprint ? (
            <Footprint
              key={mark.device.id}
              id={mark.device.id}
              corners={mark.footprint}
              color={colorOf(mark)}
              selected={selected.has(mark.device.id)}
            />
          ) : null,
        )}
        <Markers groups={groups} />
        {visible.map((mark) =>
          mark.footprint ? null : (
            <MarkerHit
              key={mark.device.id}
              id={mark.device.id}
              at={mark.at}
              shape={deviceAppearance(mark.device).shape}
            />
          ),
        )}
      </>
    ),
    [visible, selected, colorOf, groups],
  );
}

/**
 * Where a marker can be tapped. Without a scene function it is drawn only into the hit graph,
 * which is redrawn only when something is hit-tested.
 */
const MarkerHit = memo(function MarkerHit({
  id,
  at,
  shape,
}: {
  id: Id;
  at: Pt;
  shape: MarkerShape;
}) {
  const hitFunc = useMemo(
    () => (context: Konva.Context, node: Konva.Shape) => {
      context.beginPath();
      markerSubpath(context, shape, 0, 0, SELECTED_MARKER_PX / node.getAbsoluteScale().x);
      context.fillShape(node);
    },
    [shape],
  );
  return (
    <Shape
      {...selectable('devices', id)}
      x={at.x}
      y={at.y}
      hitFunc={hitFunc}
      fill={HIT_FILL}
      perfectDrawEnabled={false}
    />
  );
});
