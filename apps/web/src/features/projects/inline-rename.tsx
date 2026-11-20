import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

/** A name field that replaces a label in place. Escape or Avbryt cancels; an empty name is not saved. */
export function InlineRename({
  value,
  label,
  onSave,
  onDone,
}: {
  value: string;
  label: string;
  onSave: (name: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(value);

  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed && trimmed !== value) onSave(trimmed);
        onDone();
      }}
    >
      <Input
        aria-label={label}
        className="min-w-40 flex-1"
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <Button type="submit" size="sm">
        {t('common.save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        {t('common.cancel')}
      </Button>
    </form>
  );
}
