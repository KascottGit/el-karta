import { combine, putSpaceItem, removeSpaceItem, type Opening } from '@el-karta/core';
import { FlipHorizontal2, FlipVertical2, TriangleAlert } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { modelStore, useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { editorStore, useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { DecimalField } from '../fields/decimal-field';
import { positive, sharedValue } from '../fields/numbers';
import { openingIssues, type OpeningIssueCode } from './opening-issues';
import { isOpeningTool } from './opening-tools';
import { useOpeningsStore } from './openings-store';
import { flipHinge, flipSwing, OPENING_KINDS, resizeOpenings, withKind } from './placement';

const DIGITS = 3;

/** How to place an opening, and why the last tap placed nothing, while an opening tool is active. */
export function OpeningToolPanel() {
  const { t } = useTranslation();
  const tool = useEditorStore((s) => s.tool);
  const notice = useOpeningsStore((s) => s.notice);
  if (!isOpeningTool(tool)) return null;
  const title = t(`openings.new.${tool}`);
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="hidden text-xs text-muted-foreground md:block">{t('openings.hint')}</p>
      <p className="text-xs text-muted-foreground md:hidden">{t('openings.touchHint')}</p>
      <p role="status" className="text-sm text-amber-700 empty:hidden">
        {notice && t(notice)}
      </p>
    </section>
  );
}

/** Kind, size, door hinge and swing, validation issues and delete for the selected openings. */
export function OpeningPropsPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const selection = useEditorStore((s) => s.selection);
  const kindId = useId();
  const openings = useMemo(
    () =>
      floor
        ? selection.flatMap((s) =>
            s.collection === 'openings' ? (floor.data.openings[s.id] ?? []) : [],
          )
        : [],
    [floor, selection],
  );
  const issues = useMemo(() => {
    if (!floor) return [];
    const counts = new Map<OpeningIssueCode, number>();
    for (const opening of openings) {
      for (const issue of openingIssues(floor).get(opening.id) ?? [])
        counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }
    return [...counts];
  }, [floor, openings]);
  const single = openings.length === 1 ? openings[0] : undefined;
  if (!floor || openings.length === 0) return null;
  const kind = sharedValue(openings.map((o) => o.kind));
  const width = sharedValue(openings.map((o) => o.width));
  const height = sharedValue(openings.map((o) => o.height));
  const sill = sharedValue(openings.map((o) => o.sill));
  const title = single ? t(`openings.kinds.${single.kind}`) : t('openings.selectedCount', { count: openings.length });

  const put = (changed: readonly Opening[]) => {
    modelStore
      .getState()
      .apply(combine(...changed.map((o) => putSpaceItem(ctx.floorId, 'openings', o))));
  };
  const update = (change: (opening: Opening) => Opening) => {
    put(openings.map(change));
  };

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-1" role="group" aria-labelledby={kindId}>
        <span id={kindId} className="text-sm leading-none font-medium">
          {t('openings.kind')}
        </span>
        <div className="flex gap-2">
          {OPENING_KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind.value === k ? 'default' : 'outline'}
              aria-pressed={kind.value === k}
              onClick={() => {
                update((o) => withKind(o, k));
              }}
            >
              {t(`openings.kinds.${k}`)}
            </Button>
          ))}
        </div>
      </div>
      <DecimalField
        label={t('openings.width')}
        value={width.value}
        mixed={width.mixed}
        digits={DIGITS}
        accept={(value) => value > 0 && resizeOpenings(floor.data, openings, value) !== null}
        onCommit={(value) => {
          const resized = resizeOpenings(floor.data, openings, value);
          if (resized) put(resized);
        }}
      />
      <DecimalField
        label={t('openings.height')}
        value={height.value}
        mixed={height.mixed}
        digits={DIGITS}
        accept={positive}
        onCommit={(value) => {
          update((o) => ({ ...o, height: value }));
        }}
      />
      {openings.every((o) => o.kind === 'window') && (
        <DecimalField
          label={t('openings.sill')}
          value={sill.value}
          mixed={sill.mixed}
          digits={DIGITS}
          accept={(value) => value >= 0}
          onCommit={(value) => {
            update((o) => ({ ...o, sill: value }));
          }}
        />
      )}
      {openings.every((o) => o.kind === 'door') && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              update(flipHinge);
            }}
          >
            <FlipHorizontal2 aria-hidden />
            {t('openings.flipHinge')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              update(flipSwing);
            }}
          >
            <FlipVertical2 aria-hidden />
            {t('openings.flipSwing')}
          </Button>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label={t('openings.issues')}>
          {issues.map(([code, count]) => (
            <li key={code} className="flex items-start gap-2 text-amber-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t(`issues.${code}`)}
                {count > 1 && ` (${String(count)})`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="destructive"
        onClick={() => {
          const ids = new Set(openings.map((o) => o.id));
          modelStore
            .getState()
            .apply(
              combine(...openings.map((o) => removeSpaceItem(ctx.floorId, 'openings', o.id))),
            );
          const { selection: current, select } = editorStore.getState();
          select(current.filter((s) => !(s.collection === 'openings' && ids.has(s.id))));
        }}
      >
        {single ? t('openings.delete') : t('openings.deleteMany', { count: openings.length })}
      </Button>
    </section>
  );
}
