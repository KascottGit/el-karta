import { RoomType, signedArea, type Room, type Zone } from '@el-karta/core';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { Label } from '@/ui/label';
import type { CanvasContext } from '../canvas/extension';
import { useCanvasState } from '../canvas/use-canvas-state';
import { parseLength, updateArea, withCeilingHeight, type AreaCollection } from './area-edits';
import { areaIssues } from './area-issues';
import { issueColors } from './colors';
import { CommitInput } from './commit-input';
import { selectedArea } from './selected-area';

const formatNumber = (value: number, digits: number) =>
  new Intl.NumberFormat('sv', { maximumFractionDigits: digits }).format(value);

const fieldClass = 'flex flex-col gap-1.5';
const selectClass = 'h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm';

export function RoomPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const room = useCanvasState((editor, model) => selectedArea(editor, model, 'rooms'));
  const floorHeight = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.height);
  const typeId = useId();
  const ceilingId = useId();
  if (!room) return null;
  const update = (change: (room: Room) => Room) => {
    updateArea<Room>(ctx.floorId, 'rooms', room.id, change);
  };
  return (
    <AreaFields ctx={ctx} collection="rooms" area={room} title={t('areas.room')}>
      <div className={fieldClass}>
        <Label htmlFor={typeId}>{t('areas.type')}</Label>
        <select
          id={typeId}
          className={selectClass}
          value={room.type}
          onChange={(e) => {
            const type = RoomType.parse(e.target.value);
            update((r) => (r.type === type ? r : { ...r, type }));
          }}
        >
          {RoomType.options.map((type) => (
            <option key={type} value={type}>
              {t(`areas.roomType.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={fieldClass}>
        <Label htmlFor={ceilingId}>{t('areas.ceilingHeight')}</Label>
        <CommitInput
          id={ceilingId}
          itemId={room.id}
          inputMode="decimal"
          value={room.ceilingHeight === undefined ? '' : formatNumber(room.ceilingHeight, 3)}
          placeholder={floorHeight === undefined ? undefined : formatNumber(floorHeight, 3)}
          aria-describedby={`${ceilingId}-hint`}
          onCommit={(text) => {
            const height = parseLength(text);
            if (height === 'invalid') return false;
            update((r) => withCeilingHeight(r, height));
            return true;
          }}
        />
        {floorHeight !== undefined && (
          <p id={`${ceilingId}-hint`} className="text-xs text-muted-foreground">
            {t('areas.ceilingHeightHint', { height: formatNumber(floorHeight, 3) })}
          </p>
        )}
      </div>
    </AreaFields>
  );
}

export function ZonePanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const zone = useCanvasState((editor, model) => selectedArea(editor, model, 'zones'));
  if (!zone) return null;
  return <AreaFields ctx={ctx} collection="zones" area={zone} title={t('areas.zone')} />;
}

/** Name, area, validator issues and the editing hint, shared by rooms and zones. */
function AreaFields({
  ctx,
  collection,
  area,
  title,
  children,
}: {
  ctx: CanvasContext;
  collection: AreaCollection;
  area: Room | Zone;
  title: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const issues = useModelStore((s) => {
    const floor = s.model?.floors[ctx.floorId];
    return floor ? areaIssues(floor).get(area.id) : undefined;
  });
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className={fieldClass}>
        <Label htmlFor={nameId}>{t('areas.name')}</Label>
        <CommitInput
          id={nameId}
          itemId={area.id}
          value={area.name}
          onCommit={(name) => {
            const trimmed = name.trim();
            updateArea(ctx.floorId, collection, area.id, (a) =>
              a.name === trimmed ? a : { ...a, name: trimmed },
            );
            return true;
          }}
        />
      </div>
      {children}
      <p className="text-sm">
        {t('areas.area', { area: formatNumber(Math.abs(signedArea(area.polygon)), 1) })}
      </p>
      {issues && issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {issues.map((issue) => (
            <li key={issue.code} style={{ color: issueColors[issue.severity] }}>
              {t(issue.message, { count: issue.count })}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('areas.editHint')}</p>
    </section>
  );
}
