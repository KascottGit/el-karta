import {
  generateProject,
  SYNTHETIC_SPECS,
  type FloorRecord,
  type SyntheticSize,
} from '@el-karta/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { modelStore, useModelStore } from '@/model/store';
import { FloorEditor } from './floor-editor';

const isSize = (value: string): value is SyntheticSize => value in SYNTHETIC_SPECS;

const busiest = (floors: Record<string, FloorRecord>) =>
  Object.values(floors).reduce<FloorRecord | undefined>(
    (best, floor) =>
      !best || Object.keys(floor.data.devices).length > Object.keys(best.data.devices).length
        ? floor
        : best,
    undefined,
  );

/** Dev-only: a synthetic project in the editor without the database, for performance checks and e2e. */
export function SyntheticPage() {
  const { t } = useTranslation();
  const { size = '' } = useParams();
  const model = useModelStore((s) => s.model);

  useEffect(() => {
    if (isSize(size)) modelStore.getState().load(generateProject(size));
  }, [size]);

  if (!isSize(size)) {
    return <p>{t('editor.unknownSize', { sizes: Object.keys(SYNTHETIC_SPECS).join(', ') })}</p>;
  }
  const floor = model && busiest(model.floors);
  if (!floor) return null;
  return <FloorEditor floorId={floor.id} backTo="/" />;
}
