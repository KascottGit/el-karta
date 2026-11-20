import type { FloorCollection, Id, IssueSeverity, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Shape } from 'react-konva';
import { selectable } from '../canvas/hit';
import { issueColors } from '../canvas/theme';

const OUTLINE = '#ffffff';

const triangle = (radiusPx: number) => (context: Konva.Context, shape: Konva.Shape) => {
  const r = radiusPx / shape.getAbsoluteScale().x;
  context.beginPath();
  for (let n = 0; n < 3; n++) {
    const angle = (n * 2 * Math.PI) / 3;
    const x = r * Math.sin(angle);
    const y = -r * Math.cos(angle);
    if (n === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fillStrokeShape(shape);
};

/**
 * A warning triangle of constant screen size on a flagged item; tapping it selects the item. It
 * reads the zoom when it is drawn, so zooming never re-renders it.
 */
export const IssueMarker = memo(function IssueMarker({
  collection,
  id,
  at,
  severity,
  radiusPx,
}: {
  collection: FloorCollection;
  id: Id;
  at: Pt;
  severity: IssueSeverity;
  radiusPx: number;
}) {
  const sceneFunc = useMemo(() => triangle(radiusPx), [radiusPx]);
  return (
    <Shape
      {...selectable(collection, id)}
      x={at.x}
      y={at.y}
      sceneFunc={sceneFunc}
      fill={issueColors[severity]}
      stroke={OUTLINE}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
    />
  );
});
