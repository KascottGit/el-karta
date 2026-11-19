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
      itemAt: (screen) => (stageRef.current ? itemAt(stageRef.current, screen) : null),
      zoomToFit: () => {
        zoomToFit(floorId, registry);
      },
    }),
    [floorId, registry],
  );

  useEffect(() => {
    editorStore.getState().openFloor(floorId);
  }, [floorId]);
  useEditorKeyboard(ctx, registry);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Toolbar ctx={ctx} registry={registry} />
      <div className="relative flex min-h-0 flex-1 gap-2">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-white">
          <FloorCanvas ctx={ctx} registry={registry} stageRef={stageRef} />
        </div>
        <SidePanel ctx={ctx} registry={registry} />
      </div>
    </div>
  );
}
