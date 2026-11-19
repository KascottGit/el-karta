import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { editorStore, useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { parseDecimal } from '../fields/numbers';
import { ScaleInfo } from './scale-info';
import { applyMeasuredScale, BACKGROUND_TOOL } from './tools';

/** Steps of the scale tool, and the real length of the measured distance. */
export function ScalePanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const titleId = useId();
  const lengthId = useId();
  const floorData = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const points = useEditorStore((s) => s.drawing?.points.length ?? 0);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [applied, setApplied] = useState(false);

  const body = !floorData?.background ? (
    <>
      <p className="text-sm">{t('background.measureNeedsBackground')}</p>
      <Button
        variant="outline"
        onClick={() => {
          editorStore.getState().setTool(BACKGROUND_TOOL);
        }}
      >
        {t('background.tool')}
      </Button>
    </>
  ) : points < 2 ? (
    <>
      {applied && points === 0 && (
        <p role="status" className="text-sm font-medium">
          {t('background.scaleApplied')}
        </p>
      )}
      <p className="text-sm">
        {points === 0 ? t('background.measureStart') : t('background.measureEnd')}
      </p>
    </>
  ) : (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const metres = parseDecimal(text);
        const ok = metres !== null && applyMeasuredScale(ctx, metres);
        setInvalid(!ok);
        setApplied(ok);
        if (ok) setText('');
      }}
    >
      <p className="text-sm text-muted-foreground">{t('background.measureAdjust')}</p>
      <Label htmlFor={lengthId}>{t('background.realLength')}</Label>
      <Input
        id={lengthId}
        inputMode="decimal"
        autoComplete="off"
        placeholder={t('background.realLengthExample')}
        value={text}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${lengthId}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      {invalid && (
        <p id={`${lengthId}-error`} className="text-sm text-destructive">
          {t('background.invalidLength')}
        </p>
      )}
      <Button type="submit">{t('background.setScale')}</Button>
    </form>
  );

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="font-semibold">
        {t('background.scaleTool')}
      </h2>
      {floorData?.background && <ScaleInfo scale={floorData.scale} />}
      {body}
    </section>
  );
}
