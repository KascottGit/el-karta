import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { formatNumber, parseNumber } from './number-format';

/**
 * A field for a positive number in metres, typed with a decimal comma or point. It commits on
 * Enter or blur, so typing makes one edit rather than one per key, and Escape restores the value.
 * Left empty, it commits `undefined` when `optional`, and otherwise restores the value.
 */
export function NumberField({
  label,
  value,
  placeholder,
  optional = false,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  optional?: boolean;
  onCommit: (value: number | undefined) => void;
}) {
  const { i18n } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const text = value === undefined ? '' : formatNumber(value, i18n.language);

  const commit = () => {
    const el = input.current;
    if (!el) return;
    const typed = el.value.trim();
    const parsed = parseNumber(typed);
    if (typed === '' && optional) {
      if (value !== undefined) onCommit(undefined);
    } else if (parsed !== null && parsed > 0) {
      if (parsed !== value) onCommit(parsed);
      el.value = formatNumber(parsed, i18n.language);
    } else el.value = text;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        // Remounts with the new value after an edit, undo or redo.
        key={text}
        ref={input}
        id={id}
        inputMode="decimal"
        autoComplete="off"
        defaultValue={text}
        {...(placeholder !== undefined && { placeholder })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.currentTarget.value = text;
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
