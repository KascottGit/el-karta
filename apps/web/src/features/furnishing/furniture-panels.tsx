import { combine, type Vec3 } from '@el-karta/core';
import {
  FURNISHING_DOMAIN,
  FURNITURE_TYPES,
  type FurnitureType,
} from '@el-karta/plugin-furnishing';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { modelStore, useModelStore } from '@/model/store';
import { Label } from '@/ui/label';
import { useEditorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { CommitInput } from '@/features/floorplan/fields/commit-input';
import { DecimalField } from '@/features/floorplan/fields/decimal-field';
import { positive, sharedValue } from '@/features/floorplan/fields/numbers';
import { DeviceTypeSelect } from '@/features/devices/device-type-select';
import { deviceTypeName } from '@/features/devices/type-name';
import { furnishingStore, useFurnishingStore } from './furnishing-store';
import {
  normalizeDegrees,
  selectedFurniture,
  storeFurniture,
  withPlacement,
  withType,
  type Furniture,
} from './furniture-edits';

const DIGITS = 2;

const typeName = (type: FurnitureType) => deviceTypeName({ domain: FURNISHING_DOMAIN, type });

function TypeSelect({
  value,
  onChange,
}: {
  value: FurnitureType | undefined;
  onChange: (type: FurnitureType) => void;
}) {
  const { t } = useTranslation();
  return (
    <DeviceTypeSelect
      label={t('furnishing.type')}
      domain={FURNISHING_DOMAIN}
      types={FURNITURE_TYPES}
      value={value}
      onChange={onChange}
    />
  );
}

/** What the furniture tool places, and how. */
export function FurnitureToolPanel() {
  const { t } = useTranslation();
  const type = useFurnishingStore((s) => s.type);
  const title = t('furnishing.new');
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <TypeSelect
        value={type}
        onChange={(next) => {
          furnishingStore.setState({ type: next });
        }}
      />
      <p className="hidden text-xs text-muted-foreground md:block">{t('furnishing.hint')}</p>
      <p className="text-xs text-muted-foreground md:hidden">{t('furnishing.touchHint')}</p>
    </section>
  );
}

/** Type, name, size and rotation of the selected furniture. */
export function FurniturePropsPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const selection = useEditorStore((s) => s.selection);
  const labelId = useId();
  const items = useMemo(() => (data ? selectedFurniture(data, selection) : []), [data, selection]);
  if (items.length === 0) return null;
  const single = items.length === 1 ? items[0] : undefined;
  const type = sharedValue(items.map((i) => i.type));
  const label = sharedValue(items.map((i) => i.label));
  const sizeOf = (axis: keyof Vec3) => sharedValue(items.map((i) => i.placement.size?.[axis]));
  const rotation = sharedValue(items.map((i) => i.placement.rotation ?? 0));
  const title = single
    ? typeName(single.type as FurnitureType)
    : t('furnishing.selectedCount', { count: items.length });

  const update = (change: (item: Furniture) => Furniture) => {
    modelStore.getState().apply(combine(...items.map((i) => storeFurniture(change(i)))));
  };
  const sizeField = (axis: keyof Vec3, name: 'width' | 'depth' | 'height') => {
    const shared = sizeOf(axis);
    return (
      <DecimalField
        label={t(`furnishing.${name}`)}
        unit={t('fields.metres')}
        value={shared.value}
        mixed={shared.mixed}
        digits={DIGITS}
        accept={positive}
        onCommit={(value) => {
          update((i) => {
            const size = i.placement.size ?? { x: value, y: value, z: value };
            return withPlacement(i, { size: { ...size, [axis]: value } });
          });
        }}
      />
    );
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t('furnishing.furniture')}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <TypeSelect
        value={type.mixed ? undefined : (type.value as FurnitureType)}
        onChange={(next) => {
          update((i) => withType(i, next));
        }}
      />
      <div className="grid gap-1">
        <Label htmlFor={labelId}>{t('furnishing.label')}</Label>
        <CommitInput
          id={labelId}
          autoComplete="off"
          placeholder={label.mixed ? t('fields.mixed') : undefined}
          value={label.value ?? ''}
          valid={() => true}
          onCommit={(text) => {
            update((i) => ({ ...i, label: text.trim() }));
          }}
        />
      </div>
      {sizeField('x', 'width')}
      {sizeField('y', 'depth')}
      {sizeField('z', 'height')}
      <DecimalField
        label={t('furnishing.rotation')}
        unit={t('fields.degrees')}
        value={rotation.value}
        mixed={rotation.mixed}
        digits={1}
        signed
        onCommit={(value) => {
          update((i) => withPlacement(i, { rotation: normalizeDegrees(value) }));
        }}
      />
    </section>
  );
}
