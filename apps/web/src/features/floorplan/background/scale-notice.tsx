import { Ruler } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { editorStore } from '../editor-store';
import { SCALE_TOOL } from './tools';

/**
 * Shown while the floor's scale is an AI estimate, whatever tool is in use, so a guess is never taken
 * for a measurement (M4 decision 2). The scale tool's own panel shows the scale instead.
 */
export function ScaleNotice() {
  const { t } = useTranslation();
  return (
    <section
      role="status"
      aria-label={t('background.estimated.title')}
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <p className="text-sm font-medium">{t('background.estimated.title')}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          editorStore.getState().setTool(SCALE_TOOL);
        }}
      >
        <Ruler aria-hidden />
        {t('background.measure')}
      </Button>
    </section>
  );
}
