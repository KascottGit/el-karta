import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

export const VIEW_MODES = ['2d', '3d', 'split'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_PARAM = 'view';

export const parseViewMode = (value: string | null): ViewMode =>
  VIEW_MODES.find((m) => m === value) ?? '2d';

/** The editor's view mode, kept in the URL so it survives reload and deep links. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const mode = parseViewMode(params.get(VIEW_PARAM));
  const setMode = useCallback(
    (next: ViewMode) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === '2d') p.delete(VIEW_PARAM);
          else p.set(VIEW_PARAM, next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [mode, setMode];
}
