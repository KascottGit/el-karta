import { useState, type ComponentProps } from 'react';
import { Input } from '@/ui/input';
import { textToCommit } from './commit';

/**
 * A text field that edits a model value and commits it on Enter or blur, so typing makes one
 * undoable edit rather than one per key. Escape, or leaving it with invalid text, restores the value.
 */
export function CommitInput({
  value,
  valid,
  onCommit,
  ...props
}: {
  value: string;
  valid: (text: string) => boolean;
  onCommit: (text: string) => void;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'>) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const text = textToCommit(draft, value, valid);
    if (text !== null) onCommit(text);
    setDraft(null);
  };
  return (
    <Input
      {...props}
      value={draft ?? value}
      aria-invalid={draft !== null && !valid(draft)}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}
