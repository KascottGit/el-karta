import type { Pt } from '@el-karta/core';
import { Text } from 'react-konva';
import { canvasColors, canvasFont } from './theme';

const MIN_WIDTH_PX = 40;

/**
 * Text of constant screen size centred on a world point, cut with an ellipsis to `maxWidth` metres
 * and hidden when that is too narrow to read. Pass `renderWindow.scale` as `scale`. It is laid out
 * in pixels and scaled down, because Konva measures text badly at sub-pixel font sizes.
 */
export function ScreenLabel({
  text,
  at,
  maxWidth,
  scale,
  fontSize = 12,
  fill = canvasColors.label,
}: {
  text: string;
  at: Pt;
  maxWidth: number;
  scale: number;
  fontSize?: number;
  fill?: string;
}) {
  const widthPx = maxWidth * scale;
  if (!text || widthPx < MIN_WIDTH_PX) return null;
  return (
    <Text
      text={text}
      x={at.x}
      y={at.y}
      scaleX={1 / scale}
      scaleY={1 / scale}
      width={widthPx}
      offsetX={widthPx / 2}
      offsetY={fontSize / 2}
      fontSize={fontSize}
      fontFamily={canvasFont}
      fill={fill}
      align="center"
      wrap="none"
      ellipsis
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
