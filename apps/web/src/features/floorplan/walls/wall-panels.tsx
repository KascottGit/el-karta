import { combine, removeSpaceItem, wallLength, type Wall } from '@el-karta/core';
import { TriangleAlert } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { modelStore, useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { editorStore, useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { DecimalField } from '../fields/decimal-field';
import { formatDecimal, positive, sharedValue } from '../fields/numbers';
import { MIN_WALL_LENGTH, putWalls, setLength } from './corner';
import { wallIssues, type WallIssueCode } from './wall-issues';
import { WALL_THICKNESS, useWallsStore, wallsStore } from './walls-store';

const DIGITS = 3;

/** Settings for new walls while the wall tool is active. */
export function WallToolPanel() {
  const { t } = useTranslation();
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
            {t('walls.preset', { label, thickness: formatDecimal(value, 2) })}
          </Button>
        ))}
      </div>
      <DecimalField
        label={t('walls.thickness')}
        value={thickness}
        digits={DIGITS}
        accept={positive}
        onCommit={(value) => {
          wallsStore.setState({ thickness: value });
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
      <p className="text-xs text-muted-foreground md:hidden">{t('walls.touchHint')}</p>
    </section>
  );
}

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
  const thickness = sharedValue(walls.map((w) => w.thickness));
  const height = sharedValue(walls.map((w) => w.height));

  const update = (change: (wall: Wall) => Wall) => {
    modelStore.getState().apply(putWalls(ctx.floorId, walls.map(change)));
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t('walls.properties')}>
      <h2 className="text-sm font-semibold">
        {single ? t('walls.properties') : t('walls.selectedCount', { count: walls.length })}
      </h2>
      {single && (
        <DecimalField
          label={t('walls.length')}
          value={wallLength(single)}
          digits={DIGITS}
          accept={(length) => length >= MIN_WALL_LENGTH}
          onCommit={(length) => {
            const moved = setLength(floor.data.walls, single.id, length);
            if (moved) modelStore.getState().apply(putWalls(ctx.floorId, moved));
          }}
        />
      )}
      <DecimalField
        label={t('walls.thickness')}
        value={thickness.value}
        mixed={thickness.mixed}
        digits={DIGITS}
        accept={positive}
        onCommit={(value) => {
          update((w) => ({ ...w, thickness: value }));
        }}
      />
      <DecimalField
        label={t('walls.height')}
        value={height.value}
        mixed={height.mixed}
        placeholder={t('walls.heightDefault')}
        digits={DIGITS}
        accept={positive}
        optional
        onCommit={(value) => {
          update((w) => {
            const next = { ...w };
            if (value === null) delete next.height;
            else next.height = value;
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
