import { RoomType, signedArea, type Room, type Zone } from '@el-karta/core';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { Label } from '@/ui/label';
import type { CanvasContext } from '../canvas/extension';
import { useCanvasState } from '../canvas/use-canvas-state';
import { CommitInput } from '../fields/commit-input';
import { selectClass } from '../fields/select';
import { DecimalField } from '../fields/decimal-field';
import { formatDecimal, positive } from '../fields/numbers';
import { SnappingToggle } from '../snapping/snapping-toggle';
import { IssueList } from '../validation/issue-list';
import { updateArea, withCeilingHeight, type AreaCollection } from './area-edits';
import { areaIssues } from './area-issues';
import { selectedArea } from './selected-area';

const fieldClass = 'flex flex-col gap-1.5';

export function RoomPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const room = useCanvasState((editor, model) => selectedArea(editor, model, 'rooms'));
  const floorHeight = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.height);
  const typeId = useId();
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
      <DecimalField
        label={t('areas.ceilingHeight')}
        unit={t('fields.metres')}
        value={room.ceilingHeight}
        digits={2}
        optional
        placeholder={
          floorHeight === undefined
            ? ''
            : t('areas.ceilingHeightDefault', { height: formatDecimal(floorHeight, 2) })
        }
        accept={positive}
        onCommit={(height) => {
          update((r) => withCeilingHeight(r, height ?? undefined));
        }}
      />
    </AreaFields>
  );
}

/** Snapping and how to draw, while the room or zone tool is active. */
export function AreaToolPanel() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3" aria-label={t('areas.drawTitle')}>
      <h2 className="text-sm font-semibold">{t('areas.drawTitle')}</h2>
      <SnappingToggle />
      <p className="text-xs text-muted-foreground">{t('areas.drawHint')}</p>
    </section>
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
          autoComplete="off"
          value={area.name}
          valid={() => true}
          onCommit={(name) => {
            const trimmed = name.trim();
            updateArea(ctx.floorId, collection, area.id, (a) =>
              a.name === trimmed ? a : { ...a, name: trimmed },
            );
          }}
        />
      </div>
      {children}
      <p className="text-sm">
        {t('areas.area', { area: formatDecimal(Math.abs(signedArea(area.polygon)), 1) })}
      </p>
      <IssueList issues={issues ?? []} />
      <p className="text-xs text-muted-foreground">{t('areas.editHint')}</p>
    </section>
  );
}
