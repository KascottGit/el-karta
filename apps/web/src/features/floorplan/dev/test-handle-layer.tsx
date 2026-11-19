import { Circle } from 'react-konva';
import { useStore } from 'zustand';
import { useEditorStore } from '../editor-store';
import { handle } from '../canvas/hit';
import { TEST_HANDLE_PARAM, testHandle, testHandleStore } from './test-handle';

const RADIUS_PX = 8;

/** Dev-only: a draggable dot, shown when the URL has `?test-handle`. */
export function TestHandleLayer() {
  const at = useStore(testHandleStore, (s) => s.at);
  const scale = useEditorStore((s) => s.renderWindow.scale);
  if (!new URLSearchParams(window.location.search).has(TEST_HANDLE_PARAM)) return null;
  return (
    <Circle
      {...handle(testHandle, { from: at })}
      x={at.x}
      y={at.y}
      radius={RADIUS_PX / scale}
      fill="#f97316"
    />
  );
}
