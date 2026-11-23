import type { Id } from '@el-karta/core';
import type Konva from 'konva';
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui/utils';
import { editorStore } from '../editor-store';
import { useViewMode } from '../view-mode';
import { zoomToFit } from './commands';
import { resolveExtensions, type CanvasContext, type EditorExtension } from './extension';
import { FloorCanvas } from './floor-canvas';
import { itemAt } from './hit';
import { SidePanel } from './side-panel';
import { Toolbar } from './toolbar';
import { useEditorKeyboard } from './use-editor-keyboard';

const View3d = lazy(async () => ({ default: (await import('@/features/view3d/view-3d')).View3d }));

/**
 * Toolbar, canvas and side panel for one floor, built from the registered extensions. The view
 * mode shows the 2D canvas, the 3D view, or both side by side from `md` up.
 */
export function EditorWorkspace({
  floorId,
  extensions,
  onOpenFloor,
}: {
  floorId: Id;
  extensions: readonly EditorExtension[];
  /** Opens another floor in the editor, as the floor switcher does. */
  onOpenFloor: (floorId: Id) => void;
}) {
  const { t } = useTranslation();
  const [mode] = useViewMode();
  const registry = useMemo(() => resolveExtensions(extensions), [extensions]);
  const stageRef = useRef<Konva.Stage>(null);
  const ctx = useMemo<CanvasContext>(
    () => ({
      floorId,
      itemAt: (screen, kind = 'mouse') =>
        stageRef.current ? itemAt(stageRef.current, screen, kind) : null,
      pxToWorld: (px) => px / editorStore.getState().viewport.scale,
      zoomToFit: () => {
        zoomToFit(floorId, registry);
      },
    }),
    [floorId, registry],
  );

  useEffect(() => {
    registry.tool(editorStore.getState().tool).onDeactivate?.(ctx);
    editorStore.getState().openFloor(floorId);
  }, [floorId, registry, ctx]);
  useEditorKeyboard(ctx, registry);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-2 md:px-4">
        <Toolbar ctx={ctx} registry={registry} />
      </div>
      <div className="relative flex min-h-0 flex-1 border-t">
        {mode !== '3d' && (
          // Split shows only 3D on phones, which have no room for both.
          <div
            className={cn(
              'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white',
              mode === 'split' && 'hidden md:block',
            )}
          >
            <FloorCanvas ctx={ctx} registry={registry} stageRef={stageRef} />
          </div>
        )}
        {mode !== '2d' && (
          <div
            className={cn(
              'relative min-h-0 min-w-0 flex-1 overflow-hidden',
              mode === 'split' && 'md:border-l',
            )}
          >
            <Suspense
              fallback={<p className="p-4 text-sm text-muted-foreground">{t('view3d.loading')}</p>}
            >
              <View3d floorId={floorId} onOpenFloor={onOpenFloor} />
            </Suspense>
          </div>
        )}
        <SidePanel ctx={ctx} registry={registry} />
      </div>
    </div>
  );
}
