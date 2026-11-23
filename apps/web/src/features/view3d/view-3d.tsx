import type { Id } from '@el-karta/core';
import { Canvas } from '@react-three/fiber';
import { useTranslation } from 'react-i18next';
import { CAMERA_FOV } from './camera';
import { View3dControls } from './view3d-controls';
import { view3dBackground } from './materials';
import { Scene } from './scene';

/**
 * The read-only 3D view of the editor's floor and the floors shown with it (ADR 0008). Loaded
 * lazily, so three.js is only downloaded when someone opens it.
 */
export function View3d({
  floorId,
  onOpenFloor,
}: {
  floorId: Id;
  onOpenFloor: (floorId: Id) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="view3d-canvas"
      className="absolute inset-0 touch-none overflow-hidden select-none"
      style={{ background: view3dBackground }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 1000, position: [10, 20, 30] }}
        fallback={<p className="p-4 text-sm text-muted-foreground">{t('view3d.noWebgl')}</p>}
        aria-label={t('view3d.canvas')}
      >
        <Scene floorId={floorId} onOpenFloor={onOpenFloor} />
      </Canvas>
      <View3dControls floorId={floorId} />
    </div>
  );
}
