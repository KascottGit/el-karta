import { combine, wallLength, type PlacementKind } from '@el-karta/core';
import { POWER_DOMAIN, POWER_TYPES, SWITCH_VARIANTS, type PowerType } from '@el-karta/plugin-power';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { modelStore, useModelStore } from '@/model/store';
import { Label } from '@/ui/label';
import { useEditorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { issueColors } from '@/features/floorplan/canvas/theme';
import { CommitInput } from '@/features/floorplan/fields/commit-input';
import { DecimalField } from '@/features/floorplan/fields/decimal-field';
import { sharedValue } from '@/features/floorplan/fields/numbers';
import { selectClass } from '@/features/floorplan/fields/select';
import { storeDevice } from '@/features/devices/device-edits';
import { DeviceTypeSelect } from '@/features/devices/device-type-select';
import { deviceTypeName } from '@/features/devices/type-name';
import {
  hasCount,
  powerType,
  selectedPower,
  typesPlacedOn,
  withCount,
  withHeight,
  withOffset,
  withPowerType,
  withProp,
  type PowerDevice,
} from './power-edits';
import { powerStore, usePowerStore } from './power-store';

const DIGITS = 2;
const UNKNOWN = '';
const MIXED = '__mixed';

/**
 * A labelled choice for an optional prop, with "unknown" for a prop nobody has set. `value` is
 * undefined when unknown, `mixed` when the selected devices differ.
 */
function ChoiceField({
  label,
  options,
  value,
  mixed,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string | undefined;
  mixed: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={selectClass}
        value={mixed ? MIXED : (value ?? UNKNOWN)}
        onChange={(e) => {
          const next = e.target.value;
          if (next !== MIXED) onChange(next === UNKNOWN ? undefined : next);
        }}
      >
        {mixed && <option value={MIXED}>{t('fields.mixed')}</option>}
        <option value={UNKNOWN}>{t('power.unknown')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** What the power tool places, and how. */
export function PowerToolPanel() {
  const { t } = useTranslation();
  const type = usePowerStore((s) => s.type);
  const missed = usePowerStore((s) => s.missed);
  const title = t('power.new');
  const onWall = powerType(type).def.placements.includes('wall');
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <DeviceTypeSelect
        label={t('power.type')}
        domain={POWER_DOMAIN}
        types={POWER_TYPES}
        value={type}
        onChange={(next) => {
          powerStore.setState({ type: next, missed: false });
        }}
      />
      <p className="hidden text-xs text-muted-foreground md:block">{t('power.hint')}</p>
      <p className="text-xs text-muted-foreground md:hidden">{t('power.touchHint')}</p>
      <p role="status" className="text-sm empty:hidden" style={{ color: issueColors.error }}>
        {missed && t(onWall ? 'power.notOnWall' : 'power.notInRoom')}
      </p>
    </section>
  );
}

/** The placement kind all devices share, if they do. */
const sharedPlacement = (devices: readonly PowerDevice[]): PlacementKind | undefined =>
  sharedValue(devices.map((d) => d.placement.kind)).value;

/**
 * Type, name and props of the selected power devices; the number of sockets of outlets; height
 * and position along the wall of wall devices.
 */
export function PowerPropsPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const selection = useEditorStore((s) => s.selection);
  const labelId = useId();
  const devices = useMemo(() => (data ? selectedPower(data, selection) : []), [data, selection]);
  if (!data || devices.length === 0) return null;
  const single = devices.length === 1 ? devices[0] : undefined;
  const type = sharedValue(devices.map((d) => d.type));
  const label = sharedValue(devices.map((d) => d.label));
  const placement = sharedPlacement(devices);
  const title = single
    ? deviceTypeName(single)
    : t('power.selectedCount', { count: devices.length });

  const update = (change: (device: PowerDevice) => PowerDevice) => {
    modelStore.getState().apply(combine(...devices.map((d) => storeDevice(change(d)))));
  };
  const propOf = (key: string) =>
    sharedValue(devices.map((d) => d.props[key] as string | boolean | undefined));
  const yesNo = (key: 'earthed' | 'outdoor') => {
    const shared = propOf(key);
    return (
      <ChoiceField
        label={t(`power.${key}`)}
        options={[
          { value: 'yes', label: t('power.yes') },
          { value: 'no', label: t('power.no') },
        ]}
        value={shared.value === undefined ? undefined : shared.value ? 'yes' : 'no'}
        mixed={shared.mixed}
        onChange={(value) => {
          update((d) => withProp(d, key, value === undefined ? undefined : value === 'yes'));
        }}
      />
    );
  };
  const wall = single?.placement.kind === 'wall' ? data.walls[single.placement.wallId] : undefined;
  const heights = devices.map((d) => (d.placement.kind === 'wall' ? d.placement.height : 0));
  const offsets = devices.map((d) => (d.placement.kind === 'wall' ? d.placement.offset : 0));

  return (
    <section className="flex flex-col gap-3" aria-label={t('power.device')}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {placement && (
        <DeviceTypeSelect
          label={t('power.type')}
          domain={POWER_DOMAIN}
          types={typesPlacedOn(placement)}
          value={type.mixed ? undefined : type.value}
          onChange={(next: PowerType) => {
            update((d) => withPowerType(d, next));
          }}
        />
      )}
      <div className="grid gap-1">
        <Label htmlFor={labelId}>{t('power.label')}</Label>
        <CommitInput
          id={labelId}
          autoComplete="off"
          placeholder={label.mixed ? t('fields.mixed') : undefined}
          value={label.value ?? ''}
          valid={() => true}
          onCommit={(text) => {
            update((d) => ({ ...d, label: text.trim() }));
          }}
        />
      </div>
      {type.value !== undefined && hasCount(type.value) && (
        <>
          <DecimalField
            label={t('power.count')}
            value={sharedValue(devices.map((d) => d.count)).value}
            mixed={sharedValue(devices.map((d) => d.count)).mixed}
            placeholder={t('power.unknown')}
            digits={0}
            accept={(n) => Number.isInteger(n) && n >= 1}
            optional
            onCommit={(count) => {
              update((d) => withCount(d, count));
            }}
          />
          {yesNo('earthed')}
          {yesNo('outdoor')}
        </>
      )}
      {type.value === 'switch' && (
        <ChoiceField
          label={t('power.variant')}
          options={SWITCH_VARIANTS.map((v) => ({ value: v, label: t(`power.variants.${v}`) }))}
          value={propOf('variant').value as string | undefined}
          mixed={propOf('variant').mixed}
          onChange={(value) => {
            update((d) => withProp(d, 'variant', value));
          }}
        />
      )}
      {placement === 'wall' && (
        <>
          <DecimalField
            label={t('power.height')}
            unit={t('fields.metres')}
            value={sharedValue(heights).value}
            mixed={sharedValue(heights).mixed}
            digits={DIGITS}
            accept={(h) => h >= 0}
            onCommit={(height) => {
              update((d) => withHeight(d, height));
            }}
          />
          <DecimalField
            label={t('power.offset')}
            unit={t('fields.metres')}
            value={sharedValue(offsets).value}
            mixed={sharedValue(offsets).mixed}
            digits={DIGITS}
            accept={(o) => o >= 0 && (!wall || o <= wallLength(wall))}
            onCommit={(offset) => {
              update((d) => withOffset(data, d, offset));
            }}
          />
        </>
      )}
    </section>
  );
}
