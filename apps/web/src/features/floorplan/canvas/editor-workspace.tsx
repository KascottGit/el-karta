import type { Id } from '@el-karta/core';
import type Konva from 'konva';
import { useEffect, useMemo, useRef } from 'react';
import { editorStore } from '../editor-store';
import { zoomToFit } from './commands';
import { resolveExtensions, type CanvasContext, type EditorExtension } from './extension';
import { FloorCanvas } from './floor-canvas';
import { itemAt } from './hit';
import { SidePanel } from './side-panel';
import { Toolbar } from './toolbar';
import { useEditorKeyboard } from './use-editor-keyboard';

/** Toolbar, canvas and side panel for one floor, built from the registered extensions. */
export function EditorWorkspace({
  floorId,
  extensions,
}: {
  floorId: Id;
  extensions: readonly EditorExtension[];
}) {
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
        <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
          <FloorCanvas ctx={ctx} registry={registry} stageRef={stageRef} />
        </div>
        <SidePanel ctx={ctx} registry={registry} />
      </div>
    </div>
  );
}
