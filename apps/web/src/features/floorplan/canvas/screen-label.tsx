import type { Pt } from '@el-karta/core';
import Konva from 'konva';
import { memo, useMemo } from 'react';
import { Shape } from 'react-konva';
import { fitText } from './fit-text';
import { canvasColors, canvasFont } from './theme';

const MIN_WIDTH_PX = 40;
const MAX_CACHED = 4000;

const widths = new Map<string, number>();
const baselines = new Map<string, number>();

// Metrics measured before the web font loads are the fallback font's, so they are not kept, and
// labels are measured and drawn again once it has loaded.
const fonts =
  typeof document === 'undefined' ? undefined : (document.fonts as FontFaceSet | undefined);
const fontsReady = () => fonts?.status !== 'loading';
fonts?.addEventListener('loadingdone', () => {
  widths.clear();
  baselines.clear();
  for (const stage of Konva.stages) stage.batchDraw();
});

function measure(context: Konva.Context, font: string, text: string): number {
  const key = `${font}\n${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    if (widths.size > MAX_CACHED) widths.clear();
    width = context.measureText(text).width;
    if (fontsReady()) widths.set(key, width);
  }
  return width;
}

/** Where the alphabetic baseline goes so that the text is centred vertically, as Konva's `Text` does. */
function baselineOffset(context: Konva.Context, font: string): number {
  let offset = baselines.get(font);
  if (offset === undefined) {
    const m = context.measureText('M');
    offset = (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
    if (fontsReady()) baselines.set(font, offset);
  }
  return offset;
}

/**
 * Text of constant screen size centred on a world point, cut with an ellipsis to `maxWidth` metres
 * (but at least `minWidthPx` pixels) and hidden when that is too narrow to read. `offsetYPx` moves
 * it down by that many pixels.
 *
 * It reads the zoom when it is drawn, so it is exact at every zoom and zooming never re-renders it.
 */
export const ScreenLabel = memo(function ScreenLabel({
  text,
  at,
  maxWidth,
  minWidthPx = 0,
  offsetYPx = 0,
  fontSize = 12,
  fill = canvasColors.label,
}: {
  text: string;
  at: Pt;
  maxWidth: number;
  minWidthPx?: number;
  offsetYPx?: number;
  fontSize?: number;
  fill?: string;
}) {
  const sceneFunc = useMemo(() => {
    const font = `${fontSize}px ${canvasFont}`;
    return (context: Konva.Context, shape: Konva.Shape) => {
      const scale = shape.getAbsoluteScale().x;
      const widthPx = Math.max(maxWidth * scale, minWidthPx);
      if (widthPx < MIN_WIDTH_PX) return;
      context.setAttr('font', font);
      const shown = fitText(text, widthPx, (s) => measure(context, font, s));
      if (!shown) return;
      context.scale(1 / scale, 1 / scale);
      context.setAttr('textBaseline', 'alphabetic');
      context.setAttr('textAlign', 'center');
      context.setAttr('fillStyle', fill);
      context.fillText(shown, 0, offsetYPx + baselineOffset(context, font));
    };
  }, [text, maxWidth, minWidthPx, offsetYPx, fontSize, fill]);
  if (!text) return null;
  return (
    <Shape x={at.x} y={at.y} sceneFunc={sceneFunc} listening={false} perfectDrawEnabled={false} />
  );
});
