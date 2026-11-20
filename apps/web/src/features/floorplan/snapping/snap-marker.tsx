import type { Pt, Snap } from '@el-karta/core';
import { Circle, Line, Rect, RegularPolygon } from 'react-konva';
import { canvasColors } from '../canvas/theme';

const MARKER_PX = 6;

const flat = (points: readonly Pt[]) => points.flatMap((p) => [p.x, p.y]);

/**
 * What a point snapped to: a square on an endpoint, a triangle on a midpoint, a circle on a line,
 * a cross where two lines meet, and a dashed guide along an angle step. Nothing for a free point.
 */
export function SnapMarker({ snap, scale }: { snap: Snap; scale: number }) {
  if (snap.kind === 'none') return null;
  const r = MARKER_PX / scale;
  const { x, y } = snap.point;
  const common = {
    stroke: canvasColors.snap,
    strokeWidth: 2,
    strokeScaleEnabled: false,
    listening: false,
  } as const;
  return (
    <>
      {snap.targets.map((target, i) =>
        target.kind === 'angle' ? (
          <Line
            key={i}
            points={flat([target.from, snap.point])}
            {...common}
            strokeWidth={1}
            dash={[4, 4]}
          />
        ) : null,
      )}
      {snap.kind === 'endpoint' ? (
        <Rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...common} />
      ) : snap.kind === 'midpoint' ? (
        <RegularPolygon x={x} y={y} sides={3} radius={1.3 * r} {...common} />
      ) : (
        <Circle x={x} y={y} radius={r} {...common} />
      )}
      {snap.targets.length > 1 && (
        <Line points={[x - r, y - r, x + r, y + r]} {...common} strokeWidth={1.5} />
      )}
      {snap.targets.length > 1 && (
        <Line points={[x - r, y + r, x + r, y - r]} {...common} strokeWidth={1.5} />
      )}
    </>
  );
}
