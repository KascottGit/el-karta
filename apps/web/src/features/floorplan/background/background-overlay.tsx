import { distance, imageToWorld, type Pt } from '@el-karta/core';
import { useTranslation } from 'react-i18next';
import { Circle, Group, Line } from 'react-konva';
import { useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { handle } from '../canvas/hit';
import { ScreenLabel } from '../canvas/screen-label';
import { canvasColors } from '../canvas/theme';
import { useBackgroundImage } from './images';
import { formatDecimal } from '../fields/numbers';
import { imageCenter, imageCorners } from './plan-file';
import { BACKGROUND_TOOL, measureEndHandle, moveHandle, rotateHandle, SCALE_TOOL } from './tools';
import { useShownBackground } from './use-placement';

const MOVE_RADIUS_PX = 14;
const ROTATE_RADIUS_PX = 10;
const ROTATE_STALK_PX = 40;
const END_RADIUS_PX = 8;
const HANDLE_FILL = '#ffffff';
// See-through, so the plan under a measurement end stays visible while placing it precisely.
const END_FILL = 'rgba(255, 255, 255, 0.3)';
const MEASURE_COLOR = '#ea580c';

const flat = (points: readonly Pt[]) => points.flatMap((p) => [p.x, p.y]);

/** The image outline with move and rotate handles while the background tool is active. */
export function BackgroundHandles({ ctx }: { ctx: CanvasContext }) {
  const active = useEditorStore((s) => s.tool === BACKGROUND_TOOL);
  const scale = useEditorStore((s) => s.viewport.scale);
  const { background, placement } = useShownBackground(ctx.floorId);
  const image = useBackgroundImage(background?.attachmentId);
  if (!active || !background || !placement || image?.status !== 'ready') return null;

  const { size } = image;
  const payload = { floorId: ctx.floorId, placement };
  const center = imageToWorld(placement, imageCenter(size));
  const topMiddle = imageToWorld(placement, { x: size.width / 2, y: 0 });
  // Straight up from the image's top edge, however it is turned.
  const rad = (placement.rotation * Math.PI) / 180;
  const stalk = ROTATE_STALK_PX / scale;
  const knob = { x: topMiddle.x + Math.sin(rad) * stalk, y: topMiddle.y - Math.cos(rad) * stalk };

  return (
    <Group>
      <Line
        points={flat(imageCorners(placement, size))}
        closed
        stroke={canvasColors.selected}
        strokeWidth={1}
        strokeScaleEnabled={false}
        // With an unscaled stroke, Konva strokes in screen pixels, so the dash is in pixels too.
        dash={[6, 4]}
        listening={false}
      />
      <Line
        points={flat([topMiddle, knob])}
        stroke={canvasColors.selected}
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Circle
        {...handle(rotateHandle, { ...payload, attachmentId: background.attachmentId })}
        x={knob.x}
        y={knob.y}
        radius={ROTATE_RADIUS_PX / scale}
        fill={HANDLE_FILL}
        stroke={canvasColors.selected}
        strokeWidth={2}
        strokeScaleEnabled={false}
      />
      <Group {...handle(moveHandle, payload)} x={center.x} y={center.y}>
        <Circle
          radius={MOVE_RADIUS_PX / scale}
          fill={HANDLE_FILL}
          stroke={canvasColors.selected}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
        <Line
          points={[-6 / scale, 0, 6 / scale, 0]}
          stroke={canvasColors.selected}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
        <Line
          points={[0, -6 / scale, 0, 6 / scale]}
          stroke={canvasColors.selected}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
      </Group>
    </Group>
  );
}

/** The scale measurement: a line with draggable ends and its length at the current scale. */
export function ScaleMeasurement() {
  const { t } = useTranslation();
  const active = useEditorStore((s) => s.tool === SCALE_TOOL);
  const drawing = useEditorStore((s) => s.drawing);
  const scale = useEditorStore((s) => s.viewport.scale);
  if (!active || !drawing || drawing.points.length === 0) return null;

  const ends = drawing.hover ? [...drawing.points, drawing.hover] : drawing.points;
  const [a, b] = ends;
  const mid = a && b && { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  return (
    <Group>
      {b && (
        <Line
          points={flat(ends)}
          stroke={MEASURE_COLOR}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {drawing.points.map((p, index) => (
        <Circle
          key={index}
          {...(drawing.points.length === 2
            ? handle(measureEndHandle, { index: index as 0 | 1 })
            : {})}
          x={p.x}
          y={p.y}
          radius={END_RADIUS_PX / scale}
          fill={END_FILL}
          stroke={MEASURE_COLOR}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={drawing.points.length === 2}
        />
      ))}
      {a && b && mid && (
        <ScreenLabel
          text={t('background.metres', { value: formatDecimal(distance(a, b), 2) })}
          at={{ x: mid.x, y: mid.y - 16 / scale }}
          maxWidth={120 / scale}
          scale={scale}
          fill={MEASURE_COLOR}
        />
      )}
    </Group>
  );
}
