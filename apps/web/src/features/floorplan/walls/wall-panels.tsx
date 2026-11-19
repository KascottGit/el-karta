import { combine, removeSpaceItem, wallLength, type Wall } from '@el-karta/core';
import { TriangleAlert } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { modelStore, useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { editorStore, useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { putWalls, setLength } from './corner';
import { NumberField } from './number-field';
import { formatNumber } from './number-format';
import { wallIssues, type WallIssueCode } from './wall-issues';
import { WALL_THICKNESS, useWallsStore, wallsStore } from './walls-store';

/** Settings for new walls while the wall tool is active. */
export function WallToolPanel() {
  const { t, i18n } = useTranslation();
  const thickness = useWallsStore((s) => s.thickness);
  const snapping = useWallsStore((s) => s.snapping);
  const snapId = useId();
  const presets = [
    { label: t('walls.interior'), value: WALL_THICKNESS.interior },
    { label: t('walls.exterior'), value: WALL_THICKNESS.exterior },
  ];
  return (
    <section className="flex flex-col gap-3" aria-label={t('walls.newWalls')}>
      <h2 className="text-sm font-semibold">{t('walls.newWalls')}</h2>
      <div className="flex gap-2">
        {presets.map(({ label, value }) => (
          <Button
            key={value}
            size="sm"
            variant={thickness === value ? 'default' : 'outline'}
            aria-pressed={thickness === value}
            onClick={() => {
              wallsStore.setState({ thickness: value });
            }}
          >
            {t('walls.preset', { label, thickness: formatNumber(value, i18n.language, 2) })}
          </Button>
        ))}
      </div>
      <NumberField
        label={t('walls.thickness')}
        value={thickness}
        onCommit={(value) => {
          if (value !== undefined) wallsStore.setState({ thickness: value });
        }}
      />
      <label htmlFor={snapId} className="flex items-center gap-2 text-sm">
        <input
          id={snapId}
          type="checkbox"
          className="size-4"
          checked={snapping}
          onChange={(e) => {
            wallsStore.setState({ snapping: e.target.checked });
          }}
        />
        {t('walls.snapping')}
      </label>
      <p className="hidden text-xs text-muted-foreground md:block">{t('walls.hint')}</p>
    </section>
  );
}

const common = (values: readonly (number | undefined)[]) =>
  values.every((v) => v === values[0]) ? values[0] : undefined;

/** Length, thickness, height, validation issues and delete for the selected walls. */
export function WallPropsPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const selection = useEditorStore((s) => s.selection);
  const walls = useMemo(
    () =>
      floor
        ? selection.flatMap((s) => (s.collection === 'walls' ? (floor.data.walls[s.id] ?? []) : []))
        : [],
    [floor, selection],
  );
  const issues = useMemo(() => {
    if (!floor) return [];
    const counts = new Map<WallIssueCode, number>();
    for (const wall of walls) {
      for (const issue of wallIssues(floor).get(wall.id) ?? [])
        counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }
    return [...counts];
  }, [floor, walls]);
  const single = walls.length === 1 ? walls[0] : undefined;
  if (!floor || walls.length === 0) return null;

  const update = (change: (wall: Wall) => Wall) => {
    modelStore.getState().apply(putWalls(ctx.floorId, walls.map(change)));
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t('walls.properties')}>
      <h2 className="text-sm font-semibold">
        {single ? t('walls.properties') : t('walls.selectedCount', { count: walls.length })}
      </h2>
      {single && (
        <NumberField
          label={t('walls.length')}
          value={Math.round(wallLength(single) * 1000) / 1000}
          onCommit={(length) => {
            const moved =
              length === undefined ? null : setLength(floor.data.walls, single.id, length);
            if (moved) modelStore.getState().apply(putWalls(ctx.floorId, moved));
          }}
        />
      )}
      <NumberField
        label={t('walls.thickness')}
        value={common(walls.map((w) => w.thickness))}
        placeholder={t('walls.mixed')}
        onCommit={(thickness) => {
          if (thickness !== undefined) update((w) => ({ ...w, thickness }));
        }}
      />
      <NumberField
        label={t('walls.height')}
        value={common(walls.map((w) => w.height))}
        placeholder={t('walls.heightDefault')}
        optional
        onCommit={(height) => {
          update((w) => {
            const next = { ...w };
            if (height === undefined) delete next.height;
            else next.height = height;
            return next;
          });
        }}
      />
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label={t('walls.issues')}>
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
          const ids = new Set(walls.map((w) => w.id));
          modelStore
            .getState()
            .apply(combine(...walls.map((w) => removeSpaceItem(ctx.floorId, 'walls', w.id))));
          const { selection: current, select } = editorStore.getState();
          select(current.filter((s) => !(s.collection === 'walls' && ids.has(s.id))));
        }}
      >
        {single ? t('walls.delete') : t('walls.deleteMany', { count: walls.length })}
      </Button>
    </section>
  );
}
