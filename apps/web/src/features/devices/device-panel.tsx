import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { IssueList } from '@/features/floorplan/validation/issue-list';
import { summarizeIssues } from '@/features/floorplan/validation/issue-summary';
import { deviceIssues } from './device-issues';
import { deviceMarks } from './device-marks';
import { deviceRoomName } from './device-selection';
import { deviceTypeName } from './type-name';

/** Read-only details and validation issues of the selected devices. */
export function DevicePanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const selection = useEditorStore((s) => s.selection);
  const devices = useMemo(
    () =>
      floor
        ? selection.flatMap((s) =>
            s.collection === 'devices' ? (floor.data.devices[s.id] ?? []) : [],
          )
        : [],
    [floor, selection],
  );
  const issues = useMemo(
    () =>
      floor ? summarizeIssues(devices.flatMap((d) => deviceIssues(floor).get(d.id) ?? [])) : [],
    [floor, devices],
  );
  if (!floor || devices.length === 0) return null;
  const single = devices.length === 1 ? devices[0] : undefined;
  const title = single
    ? t('devices.device')
    : t('devices.selectedCount', { count: devices.length });
  const hidden =
    single && single.placement.kind !== 'container' && !(single.id in deviceMarks(floor.data));

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {single && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('devices.label')}</dt>
          <dd>{single.label || t('devices.noLabel')}</dd>
          <dt className="text-muted-foreground">{t('devices.type')}</dt>
          <dd>{deviceTypeName(single)}</dd>
          <dt className="text-muted-foreground">{t('devices.room')}</dt>
          <dd>{deviceRoomName(floor, single) ?? t('devices.noRoom')}</dd>
        </dl>
      )}
      <IssueList issues={issues} />
      {hidden && <p className="text-xs text-muted-foreground">{t('devices.notDrawn')}</p>}
    </section>
  );
}
