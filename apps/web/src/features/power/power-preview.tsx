import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { DevicePreviewGhost } from '@/features/devices/dragged-device';
import { usePowerStore } from './power-store';

/** Where the power tool would place a device, under a hovering mouse or pen. */
export function PowerPreview({ ctx }: { ctx: CanvasContext }) {
  const preview = usePowerStore((s) => s.preview);
  return <DevicePreviewGhost ctx={ctx} preview={preview} />;
}
