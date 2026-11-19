import type { FloorScale } from '@el-karta/core';
import { useTranslation } from 'react-i18next';
import { formatDecimal } from '../fields/numbers';

/** The floor's scale in words, or that it is not set yet. */
export function ScaleInfo({ scale }: { scale: FloorScale | undefined }) {
  const { t } = useTranslation();
  if (!scale) return <p className="text-sm text-muted-foreground">{t('background.scaleNotSet')}</p>;
  return (
    <p className="text-sm" data-testid="background-scale">
      {t('background.scaleValue', {
        mm: formatDecimal(scale.metresPerPixel * 1000, 3),
        source: t(`background.scaleSource.${scale.source}`),
      })}
    </p>
  );
}
