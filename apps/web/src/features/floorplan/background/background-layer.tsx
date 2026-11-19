import { useEffect } from 'react';
import { Image } from 'react-konva';
import { useStore } from 'zustand';
import { editorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { backgroundUi } from './background-store';
import { useBackgroundImage } from './images';
import { useShownBackground } from './use-placement';

/**
 * The floor's plan image, one Konva image node transformed into the plan. Panning and zooming move
 * the stage, so this re-renders only when the placement, the image or the opacity changes.
 */
export function BackgroundLayer({ ctx }: { ctx: CanvasContext }) {
  const { background, placement } = useShownBackground(ctx.floorId);
  const image = useBackgroundImage(background?.attachmentId);
  const opacity = useStore(backgroundUi, (s) => s.opacity);
  const ready = image?.status === 'ready';

  // The first fit may have happened before the image arrived; fit again unless the view was moved.
  useEffect(() => {
    if (ready && editorStore.getState().fitted) ctx.zoomToFit();
  }, [ready, ctx]);

  if (!placement || image?.status !== 'ready') return null;
  return (
    <Image
      image={image.image}
      x={placement.offset.x}
      y={placement.offset.y}
      rotation={placement.rotation}
      scaleX={placement.metresPerPixel}
      scaleY={placement.metresPerPixel}
      opacity={opacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
