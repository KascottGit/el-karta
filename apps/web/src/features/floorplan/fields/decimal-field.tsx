import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/ui/label';
import { CommitInput } from './commit-input';
import { decimalText, readDecimal } from './numbers';

interface CommonProps {
  label: string;
  /** Null or undefined shows an empty field. */
  value: number | null | undefined;
  /** Decimals shown; typed values keep their full precision. */
  digits: number;
  /** Allows negative numbers. Phones' decimal keypads have no minus sign, so this gets the full keyboard. */
  signed?: boolean;
  /** Shown after the field, such as `m` or `°`. */
  unit?: string;
  /** Several selected items with different values: empty, with a placeholder saying so. */
  mixed?: boolean;
  /** Shown while the field is empty and not mixed, such as what an unset optional value falls back to. */
  placeholder?: string;
  accept?: (value: number) => boolean;
}

type DecimalFieldProps = CommonProps &
  (
    | { optional?: false; onCommit: (value: number) => void }
    | { optional: true; onCommit: (value: number | null) => void }
  );

/** A labelled number field with a decimal comma that commits on Enter or blur (see `CommitInput`). */
export function DecimalField(props: DecimalFieldProps) {
  const { label, value, digits, signed = false, unit, mixed = false, placeholder, accept } = props;
  const { t } = useTranslation();
  const id = useId();
  const rules = { optional: props.optional ?? false, ...(accept ? { accept } : {}) };

  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <CommitInput
          id={id}
          inputMode={signed ? 'text' : 'decimal'}
          autoComplete="off"
          placeholder={mixed ? t('fields.mixed') : placeholder}
          value={decimalText(value, digits, mixed)}
          valid={(text) => readDecimal(text, rules).ok}
          onCommit={(text) => {
            const read = readDecimal(text, rules);
            if (!read.ok) return;
            if (props.optional) props.onCommit(read.value);
            else if (read.value !== null) props.onCommit(read.value);
          }}
        />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
