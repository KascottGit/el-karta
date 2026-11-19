import type { EditorExtension } from '../canvas/extension';
import { testHandle } from './test-handle';
import { TestHandleLayer } from './test-handle-layer';

/** Dev-only test fixtures for the canvas, registered in development builds. */
export const devExtension: EditorExtension = {
  id: 'dev',
  handles: [testHandle],
  layers: [{ id: 'dev-test-handle', layer: 'overlays', order: 1000, Component: TestHandleLayer }],
};
