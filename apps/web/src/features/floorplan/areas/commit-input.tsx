import type { ComponentProps } from 'react';
import { Input } from '@/ui/input';

/**
 * A text field that changes the model once, when it loses focus or on Enter, rather than on every
 * key, so a rename is one undo step. Escape restores the stored value. `onCommit` returns false to
 * reject the text, which also restores it.
 */
export function CommitInput({
  value,
  onCommit,
  itemId,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onBlur' | 'onKeyDown'> & {
  value: string;
  onCommit: (text: string) => boolean;
  /** Remounts the field for another item, or when the stored value changes (undo, someone else). */
  itemId: string;
}) {
  return (
    <Input
      key={`${itemId}:${value}`}
      {...props}
      defaultValue={value}
      onBlur={(e) => {
        const text = e.currentTarget.value;
        if (text !== value && !onCommit(text)) e.currentTarget.value = value;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
