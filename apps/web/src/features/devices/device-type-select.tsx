import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/ui/label';
import { selectClass } from '@/features/floorplan/fields/select';
import { deviceTypeName } from './type-name';

const MIXED = '';

/**
 * A labelled choice among a domain's device types, by their Swedish names. An undefined `value`
 * means the selected devices differ.
 */
export function DeviceTypeSelect<T extends string>({
  label,
  domain,
  types,
  value,
  onChange,
}: {
  label: string;
  domain: string;
  types: readonly T[];
  value: T | undefined;
  onChange: (type: T) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={selectClass}
        value={value ?? MIXED}
        onChange={(e) => {
          const next = types.find((type) => type === e.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {value === undefined && <option value={MIXED}>{t('fields.mixed')}</option>}
        {types.map((type) => (
          <option key={type} value={type}>
            {deviceTypeName({ domain, type })}
          </option>
        ))}
      </select>
    </div>
  );
}
