import { backgroundPlacement, type BackgroundPlacement, type Id } from '@el-karta/core';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useModelStore } from '@/model/store';
import { backgroundUi } from './background-store';

/** The floor's background and where it is shown: the placement being dragged, else the stored one. */
export function useShownBackground(floorId: Id) {
  const background = useModelStore((s) => s.model?.floors[floorId]?.data.background);
  const scale = useModelStore((s) => s.model?.floors[floorId]?.data.scale);
  const draft = useStore(backgroundUi, (s) =>
    s.draft?.floorId === floorId ? s.draft.placement : null,
  );
  const stored = useMemo(() => backgroundPlacement(background, scale), [background, scale]);
  const placement: BackgroundPlacement | null = background ? (draft ?? stored) : null;
  return { background, scale, placement };
}
