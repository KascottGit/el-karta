import type { EditorExtension } from '../canvas/extension';
import { exportFacitAction } from './facit-export';
import { testHandle } from './test-handle';
import { TestHandleLayer } from './test-handle-layer';

/** Dev-only test fixtures and eval tools for the canvas, registered in development builds. */
export const devExtension: EditorExtension = {
  id: 'dev',
  actions: [exportFacitAction],
  handles: [testHandle],
  layers: [{ id: 'dev-test-handle', layer: 'overlays', order: 1000, Component: TestHandleLayer }],
};
