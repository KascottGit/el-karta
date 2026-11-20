import type { Opening, Wall } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { Line } from 'react-konva';
import { handle, nodeProps, selectable } from '../canvas/hit';
import { canvasColors } from '../canvas/theme';
import { wallColors } from '../walls/colors';
import { openingSlide } from './opening-handle';
import { openingSymbol } from './symbol';

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

/**
 * A door, window or passage in its wall: a gap over the wall, plus a door's open leaf and swing
 * or a window's panes. Only the gap can be hit; it selects the opening and slides it along the wall.
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
  if (!symbol) return null;
  const { gap, edge, line } = looks[look];
  const stroke = { stroke: line, strokeScaleEnabled: false, listening: false } as const;
  return (
    <>
      <Line
        {...nodeProps(selectable('openings', opening.id), handle(openingSlide, { id: opening.id }))}
        points={symbol.gap}
        closed
        fill={gap}
        stroke={edge}
        strokeWidth={look === 'plain' ? 2 : 1}
        strokeScaleEnabled={false}
        hitStrokeWidth={8}
        listening={listening}
        perfectDrawEnabled={false}
      />
      {symbol.leaf && <Line points={symbol.leaf} strokeWidth={2} {...stroke} />}
      {symbol.arc && <Line points={symbol.arc} strokeWidth={1} {...stroke} />}
      {symbol.panes?.map((pane, i) => (
        <Line key={i} points={pane} strokeWidth={1} {...stroke} />
      ))}
    </>
  );
});
