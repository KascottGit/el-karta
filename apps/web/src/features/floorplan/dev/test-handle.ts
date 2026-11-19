import type { Pt } from '@el-karta/core';
import { createStore } from 'zustand/vanilla';
import type { Handle } from '../canvas/extension';

export const TEST_HANDLE_PARAM = 'test-handle';
export const TEST_HANDLE_START: Pt = { x: 2, y: 2 };

/** Dev-only: where the test handle is and what happened to it, read by the e2e tests. */
export const testHandleStore = createStore<{ at: Pt; events: string[] }>()(() => ({
  at: TEST_HANDLE_START,
  events: [],
}));

const log = (event: string, at: Pt) => {
  testHandleStore.setState((s) => ({ at, events: [...s.events, event] }));
};

export const testHandle: Handle<{ from: Pt }> = {
  name: 'dev-test-handle',
  onDragStart: (_payload, _start, p) => {
    log(`start:${p.kind}`, p.world);
  },
  onDrag: (_payload, p) => {
    log('drag', p.world);
  },
  onDragEnd: (_payload, p) => {
    log('end', p.world);
  },
  onDragCancel: ({ from }) => {
    log('cancel', from);
  },
};
