import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import type { CanvasContext } from '../canvas/extension';
import {
  cancelImport,
  connectImport,
  estimateScale,
  measureScale,
  retryImport,
} from './controller';
import { useImport, type ImportStep } from './import-store';

function Busy({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
      {text}
    </p>
  );
}

function CancelButton() {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" onClick={cancelImport}>
      {t('common.cancel')}
    </Button>
  );
}

function Body({ current }: { current: ImportStep }) {
  const { t } = useTranslation();
  switch (current.step) {
    case 'idle':
      return null;
    case 'reading':
      return (
        <>
          <Busy
            text={
              current.progress?.step === 'tile' && current.progress.count > 1
                ? t('ai.import.readingTile', {
                    index: current.progress.index + 1,
                    count: current.progress.count,
                  })
                : current.progress?.step === 'tile'
                  ? t('ai.import.reading')
                  : t('ai.import.locating')
            }
          />
          <p className="text-sm text-muted-foreground">{t('ai.import.keepEditing')}</p>
          <CancelButton />
        </>
      );
    case 'ask-scale':
      return (
        <>
          <p className="text-sm font-medium">{t('ai.import.askScale')}</p>
          <p className="text-sm">{t('ai.import.askScaleHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={measureScale}>{t('ai.import.measure')}</Button>
            <Button variant="outline" onClick={() => void estimateScale()}>
              {t('ai.import.estimate')}
            </Button>
            <CancelButton />
          </div>
        </>
      );
    case 'measuring':
      return (
        <>
          <p className="text-sm">{t('ai.import.measuring')}</p>
          <CancelButton />
        </>
      );
    case 'saving':
      return <Busy text={t('ai.import.saving')} />;
    case 'updating':
      return <Busy text={t('ai.import.updating')} />;
    case 'failed':
      return (
        <>
          <p role="alert" className="text-sm text-destructive">
            {t(`ai.import.errors.${current.error}`)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void retryImport();
              }}
            >
              {t('ai.import.retry')}
            </Button>
            <Button variant="ghost" onClick={cancelImport}>
              {t('ai.import.close')}
            </Button>
          </div>
        </>
      );
  }
}

/** Progress, the scale question and errors of an import of this floor's plan. */
export function ImportPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const titleId = useId();
  const current = useImport();
  if (current.step === 'idle' || current.floorId !== ctx.floorId) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="font-semibold">
        {t('ai.import.action')}
      </h2>
      <Body current={current} />
    </section>
  );
}

/**
 * Draws nothing; mounted with the canvas so the import has the query cache and hears about scales
 * set with the scale tool while a floor is open.
 */
export function ImportConnector() {
  const queries = useQueryClient();
  useEffect(() => connectImport(queries), [queries]);
  return null;
}
