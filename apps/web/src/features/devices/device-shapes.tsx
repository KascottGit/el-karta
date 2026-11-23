import type { Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Line, Shape } from 'react-konva';
import { selectable } from '@/features/floorplan/canvas/hit';
import { canvasColors } from '@/features/floorplan/canvas/theme';
import { markerSprite } from './marker-sprites';
import { FOOTPRINT_ALPHA, OUTLINE_PX, SELECTED_OUTLINE_PX, type MarkerGroup } from './marker-style';

/** Paints every visible marker. It reads the zoom when it is drawn, so zooming never re-renders it. */
export const Markers = memo(function Markers({ groups }: { groups: readonly MarkerGroup[] }) {
  const sceneFunc = useMemo(
    () => (context: Konva.Context, node: Konva.Shape) => {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = node.getAbsoluteTransform().getMatrix();
      const ratio = context.getCanvas().getPixelRatio();
      // Sprites are copied in device pixels, one to one, so they stay sharp.
      context.setTransform(1, 0, 0, 1, 0, 0);
      for (const { style, at } of groups) {
        const sprite = markerSprite(style, ratio);
        const half = sprite.width / 2;
        for (const { x, y } of at) {
          const px = (a * x + c * y + e) * ratio;
          const py = (b * x + d * y + f) * ratio;
          context.drawImage(sprite, Math.round(px - half), Math.round(py - half));
        }
      }
    },
    [groups],
  );
  return <Shape sceneFunc={sceneFunc} listening={false} perfectDrawEnabled={false} />;
});

/** A device drawn at its own size: its footprint, selectable unless `id` is left out. */
export const Footprint = memo(function Footprint({
  id,
  corners,
  color,
  selected,
}: {
  id?: Id;
  corners: readonly Pt[];
  color: string;
  selected: boolean;
}) {
  const points = useMemo(() => corners.flatMap((p) => [p.x, p.y]), [corners]);
  return (
    <Line
      {...(id === undefined ? { listening: false } : selectable('devices', id))}
      points={points}
      closed
      fill={withAlpha(selected ? canvasColors.selected : color, FOOTPRINT_ALPHA)}
      stroke={selected ? canvasColors.selected : color}
      strokeWidth={selected ? SELECTED_OUTLINE_PX : OUTLINE_PX}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
    />
  );
});

/** `#rrggbb` with an alpha channel, so a footprint's fill is translucent but its outline is not. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
