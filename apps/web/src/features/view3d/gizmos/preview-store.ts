import type { FloorData, Id } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { HandleName } from './handles';

export interface GizmoState {
  /** The floor being dragged on, drawn from this data instead of the committed data (ADR 0009). */
  preview: { floorId: Id; data: FloorData } | null;
  /** The handle being dragged, drawn in its own colour. */
  active: HandleName | null;
}

/** The 3D view's gizmo drag state. Never saved or undone: release commits one edit through the model store. */
export const gizmoStore = createStore<GizmoState>()(() => ({ preview: null, active: null }));

export const useGizmoStore = <T>(selector: (state: GizmoState) => T): T =>
  useStore(gizmoStore, selector);

/** The preview data of `floorId`, or null when it is not being dragged on. */
export const usePreviewData = (floorId: Id) =>
  useGizmoStore((s) => (s.preview?.floorId === floorId ? s.preview.data : null));
