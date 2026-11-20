import type { Opening, Wall } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Shape } from 'react-konva';
import { handle, nodeProps, selectable } from '../canvas/hit';
import { canvasColors } from '../canvas/theme';
import { wallColors } from '../walls/colors';
import { openingSlide } from './opening-handle';
import { openingSymbol, type OpeningSymbol } from './symbol';

export type OpeningLook = 'plain' | 'selected' | 'preview';

const looks: Readonly<Record<OpeningLook, { gap: string; edge: string; line: string }>> = {
  // The gap is drawn over the wall in the canvas background colour, edge included, so it also
  // covers the wall's one-pixel outline.
  plain: { gap: '#ffffff', edge: '#ffffff', line: wallColors.wall },
  selected: {
    gap: canvasColors.selectedFill,
    edge: canvasColors.selected,
    line: canvasColors.selected,
  },
  preview: { gap: wallColors.draft, edge: wallColors.draftLine, line: wallColors.draftLine },
};

function path(context: Konva.Context, points: readonly number[]) {
  context.moveTo(points[0] ?? 0, points[1] ?? 0);
  for (let i = 2; i < points.length; i += 2) context.lineTo(points[i]!, points[i + 1]!);
}

function stroke(context: Konva.Context, color: string, width: number) {
  context.setAttr('strokeStyle', color);
  context.setAttr('lineWidth', width);
  context.stroke();
}

/** Below this many pixels wide, an opening is drawn as its gap only. */
const DETAIL_PX = 8;

// One canvas node per opening, since the large project has thousands: the gap, leaf, swing and
// panes are drawn by hand, in pixel widths, rather than as separate Konva lines.
const drawSymbol =
  (symbol: OpeningSymbol, look: OpeningLook) => (context: Konva.Context, shape: Konva.Shape) => {
    const px = 1 / shape.getAbsoluteScale().x;
    const colors = looks[look];
    context.beginPath();
    path(context, symbol.gap);
    context.closePath();
    context.setAttr('fillStyle', colors.gap);
    context.fill();
    stroke(context, colors.edge, px);
    if (symbol.width < DETAIL_PX * px) return;
    if (symbol.arc) {
      context.beginPath();
      path(context, symbol.arc);
      stroke(context, colors.line, px);
    }
    if (symbol.leaf) {
      context.beginPath();
      path(context, symbol.leaf);
      stroke(context, colors.line, 2 * px);
    }
    if (symbol.panes) {
      context.beginPath();
      for (const pane of symbol.panes) path(context, pane);
      stroke(context, colors.line, px);
    }
  };

/** Only the gap can be hit, so taps in the room under a door's swing reach the room. */
const hitGap = (gap: readonly number[]) => (context: Konva.Context, shape: Konva.Shape) => {
  context.beginPath();
  path(context, gap);
  context.closePath();
  context.fillStrokeShape(shape);
};

/**
 * A door, window or passage in its wall: a gap over the wall, plus a door's open leaf and swing
 * or a window's panes. The gap selects the opening and slides it along the wall.
 */
export const OpeningShape = memo(function OpeningShape({
  wall,
  opening,
  look,
  listening = true,
}: {
  wall: Wall;
  opening: Opening;
  look: OpeningLook;
  listening?: boolean;
}) {
  const symbol = useMemo(() => openingSymbol(wall, opening), [wall, opening]);
  const draw = useMemo(() => symbol && drawSymbol(symbol, look), [symbol, look]);
  const hit = useMemo(() => symbol && hitGap(symbol.gap), [symbol]);
  if (!draw || !hit) return null;
  return (
    <Shape
      {...nodeProps(selectable('openings', opening.id), handle(openingSlide, { id: opening.id }))}
      sceneFunc={draw}
      hitFunc={hit}
      fill={looks[look].gap}
      stroke={looks[look].edge}
      strokeWidth={1}
      strokeScaleEnabled={false}
      hitStrokeWidth={8}
      listening={listening}
      perfectDrawEnabled={false}
    />
  );
});
