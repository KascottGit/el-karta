import type { Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Circle, Line, Shape } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { handle, nodeProps, selectable } from '@/features/floorplan/canvas/hit';
import { canvasColors } from '@/features/floorplan/canvas/theme';
import { deviceAppearance } from '@/features/devices/appearance';
import { useDraggedDevice } from '@/features/devices/device-drag';
import { Footprint } from '@/features/devices/device-shapes';
import { footprintCorners, sizedFootprint } from '@/features/devices/placement';
import { useFurnishingStore } from './furnishing-store';
import { furnitureMove, furnitureRotate } from './furniture-handles';
import { asFurniture, selectedFurniture, type Furniture } from './furniture-edits';

/** Screen pixels from the item's back edge to the rotation knob. */
export const KNOB_GAP_PX = 28;
const KNOB_PX = 8;
// Any colour: hit shapes are drawn in their hit colour, never on screen.
const HIT_FILL = '#000000';

/** Where the furniture tool would place an item, under a hovering mouse or pen. */
export function FurniturePreview({ ctx }: { ctx: CanvasContext }) {
  const preview = useFurnishingStore((s) =>
    s.preview?.floorId === ctx.floorId ? s.preview.device : null,
  );
  const footprint = preview && sizedFootprint(preview);
  const corners = useMemo(() => footprint && footprintCorners(footprint), [footprint]);
  if (!preview || !corners) return null;
  return <Footprint corners={corners} color={deviceAppearance(preview).color} selected={false} />;
}

/**
 * Move and rotation handles on the selected furniture: drag the body to move it, the knob behind
 * it to turn it. They follow the item while it is dragged.
 */
export function FurnitureHandles({ ctx }: { ctx: CanvasContext }) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const selection = useEditorStore((s) => s.selection);
  const drawing = useEditorStore((s) => s.drawing);
  const scale = useEditorStore((s) => s.viewport.scale);
  const dragged = asFurniture(useDraggedDevice(ctx.floorId) ?? undefined);
  const items = useMemo(() => (data ? selectedFurniture(data, selection) : []), [data, selection]);
  if (drawing) return null;
  return items.map((item) => (
    <ItemHandles key={item.id} item={dragged?.id === item.id ? dragged : item} scale={scale} />
  ));
}

const ItemHandles = memo(function ItemHandles({ item, scale }: { item: Furniture; scale: number }) {
  const footprint = sizedFootprint(item);
  const corners = useMemo(() => footprint && footprintCorners(footprint), [footprint]);
  if (!footprint || !corners) return null;
  const { center, size, rotation } = footprint;
  // The knob sits behind the item, along its local -y axis.
  const reach = size.y / 2 + KNOB_GAP_PX / scale;
  const back = { x: Math.sin(rotation), y: -Math.cos(rotation) };
  const edge = { x: center.x + (back.x * size.y) / 2, y: center.y + (back.y * size.y) / 2 };
  const knob = { x: center.x + back.x * reach, y: center.y + back.y * reach };
  return (
    <>
      <Body id={item.id} corners={corners} />
      <Line
        points={[edge.x, edge.y, knob.x, knob.y]}
        stroke={canvasColors.selected}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Circle
        {...handle(furnitureRotate, { id: item.id })}
        x={knob.x}
        y={knob.y}
        radius={KNOB_PX / scale}
        fill="#ffffff"
        stroke={canvasColors.selected}
        strokeWidth={2}
        strokeScaleEnabled={false}
      />
    </>
  );
});

/** The item's footprint in the hit graph only, as a move handle that still selects on tap. */
function Body({ id, corners }: { id: Id; corners: readonly Pt[] }) {
  const hitFunc = useMemo(
    () => (context: Konva.Context, node: Konva.Shape) => {
      context.beginPath();
      corners.forEach((p, i) => {
        if (i === 0) context.moveTo(p.x, p.y);
        else context.lineTo(p.x, p.y);
      });
      context.closePath();
      context.fillShape(node);
    },
    [corners],
  );
  return (
    <Shape
      {...nodeProps(selectable('devices', id), handle(furnitureMove, { id }))}
      hitFunc={hitFunc}
      fill={HIT_FILL}
      perfectDrawEnabled={false}
    />
  );
}
