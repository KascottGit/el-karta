import type { Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Shape } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { handle, nodeProps, selectable } from '@/features/floorplan/canvas/hit';
import { useDraggedDevice } from './device-drag';
import { deviceMark, deviceMarks } from './device-marks';
import { deviceMove, isMovableMarker } from './device-move';

/** Screen radius of a selected marker's move handle; a little more than the marker itself. */
const GRIP_PX = 12;
// Any colour: hit shapes are drawn in their hit colour, never on screen.
const HIT_FILL = '#000000';

/**
 * A move handle on each selected wall or ceiling device's marker, which still selects on tap. It
 * follows the marker while it is dragged.
 */
export function DeviceMoveHandles({ ctx }: { ctx: CanvasContext }) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const selection = useEditorStore((s) => s.selection);
  const drawing = useEditorStore((s) => s.drawing);
  const dragged = useDraggedDevice(ctx.floorId);
  const grips = useMemo(() => {
    if (!data) return [];
    const marks = deviceMarks(data);
    return selection.flatMap((s) => {
      if (s.collection !== 'devices') return [];
      const mark = dragged?.id === s.id ? deviceMark(data, dragged) : (marks[s.id] ?? null);
      return mark && !mark.footprint && isMovableMarker(mark.device)
        ? [{ id: s.id, at: mark.at }]
        : [];
    });
  }, [data, selection, dragged]);
  if (drawing) return null;
  return grips.map((g) => <Grip key={g.id} id={g.id} at={g.at} />);
}

const Grip = memo(function Grip({ id, at }: { id: Id; at: Pt }) {
  return (
    <Shape
      {...nodeProps(selectable('devices', id), handle(deviceMove, { id }))}
      x={at.x}
      y={at.y}
      hitFunc={gripHit}
      fill={HIT_FILL}
      perfectDrawEnabled={false}
    />
  );
});

function gripHit(context: Konva.Context, node: Konva.Shape) {
  context.beginPath();
  context.arc(0, 0, GRIP_PX / node.getAbsoluteScale().x, 0, 2 * Math.PI);
  context.fillShape(node);
}
