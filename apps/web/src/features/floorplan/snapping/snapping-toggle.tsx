import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { setSnapping, useSnappingEnabled } from './snapping';

/** The checkbox that turns snapping on and off for every drawing tool. */
export function SnappingToggle() {
  const { t } = useTranslation();
  const enabled = useSnappingEnabled();
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="size-4"
        checked={enabled}
        onChange={(e) => {
          setSnapping(e.target.checked);
        }}
      />
      {t('snapping.enabled')}
    </label>
  );
}
