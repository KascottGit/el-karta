import Konva from 'konva';
import type { MarkerShape } from './appearance';
import { markerSubpath } from './marker-path';

export interface MarkerStyle {
  shape: MarkerShape;
  fill: string;
  stroke: string;
  /** Radius and outline width in screen pixels. */
  radiusPx: number;
  lineWidthPx: number;
}

const MAX_SPRITES = 256;
const sprites = new Map<string, HTMLCanvasElement>();

/**
 * A marker drawn once into a small canvas at the device pixel ratio. Copying it is much cheaper
 * than filling and stroking a path per marker, which dominated frame time on large floors.
 */
export function markerSprite(style: MarkerStyle, pixelRatio: number): HTMLCanvasElement {
  const { shape, fill, stroke, radiusPx, lineWidthPx } = style;
  const key = `${shape}|${fill}|${stroke}|${radiusPx}|${lineWidthPx}|${pixelRatio}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    if (sprites.size > MAX_SPRITES) sprites.clear();
    const half = radiusPx + lineWidthPx;
    sprite = Konva.Util.createCanvasElement();
    sprite.width = sprite.height = Math.ceil(2 * half * pixelRatio);
    const context = sprite.getContext('2d');
    if (context) {
      context.scale(pixelRatio, pixelRatio);
      context.beginPath();
      markerSubpath(context, shape, half, half, radiusPx);
      context.fillStyle = fill;
      context.fill();
      context.strokeStyle = stroke;
      context.lineWidth = lineWidthPx;
      context.stroke();
    }
    sprites.set(key, sprite);
  }
  return sprite;
}
