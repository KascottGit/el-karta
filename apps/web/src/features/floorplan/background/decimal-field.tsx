import { useId, useState } from 'react';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { formatDecimal, parseDecimal } from './numbers';

/**
 * A number field that takes a decimal comma, and commits on Enter or when it loses focus. Phones'
 * decimal keypads have no minus sign, so `signed` fields get the full keyboard.
 */
export function DecimalField({
  label,
  value,
  digits,
  signed = false,
  onCommit,
}: {
  label: string;
  value: number;
  digits: number;
  signed?: boolean;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() => formatDecimal(value, digits));
  const [shown, setShown] = useState(value);
  const [invalid, setInvalid] = useState(false);
  if (value !== shown) {
    setShown(value);
    setText(formatDecimal(value, digits));
    setInvalid(false);
  }

  const commit = () => {
    const parsed = parseDecimal(text);
    setInvalid(parsed === null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };

  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={signed ? 'text' : 'decimal'}
        autoComplete="off"
        value={text}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}
