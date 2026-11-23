import {
  generateProject,
  SYNTHETIC_SPECS,
  type FloorRecord,
  type Id,
  type SyntheticSize,
} from '@el-karta/core';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { modelStore, useModelStore } from '@/model/store';
import { FloorEditor } from './floor-editor';

const isSize = (value: string): value is SyntheticSize => value in SYNTHETIC_SPECS;

const FLOOR_PARAM = 'floor';

const busiest = (floors: Record<string, FloorRecord>) =>
  Object.values(floors).reduce<FloorRecord | undefined>(
    (best, floor) =>
      !best || Object.keys(floor.data.devices).length > Object.keys(best.data.devices).length
        ? floor
        : best,
    undefined,
  );

/**
 * Dev-only: a synthetic project in the editor without the database, for performance checks and
 * e2e. It opens the busiest floor, or the one in `?floor=`.
 */
export function SyntheticPage() {
  const { t } = useTranslation();
  const { size = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const chosen = params.get(FLOOR_PARAM);
  // The floor id rather than the model, so that edits do not re-render the page.
  const floorId = useModelStore(
    (s) => s.model && (chosen && s.model.floors[chosen] ? chosen : busiest(s.model.floors)?.id),
  );
  const openFloor = useCallback(
    (id: Id) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(FLOOR_PARAM, id);
        return next;
      });
    },
    [setParams],
  );

  useEffect(() => {
    if (isSize(size)) modelStore.getState().load(generateProject(size));
  }, [size]);

  if (!isSize(size)) {
    return (
      <p className="p-4">
        {t('editor.unknownSize', { sizes: Object.keys(SYNTHETIC_SPECS).join(', ') })}
      </p>
    );
  }
  if (!floorId) return null;
  return <FloorEditor floorId={floorId} backTo="/" onOpenFloor={openFloor} />;
}
