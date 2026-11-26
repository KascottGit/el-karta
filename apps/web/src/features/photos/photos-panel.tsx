import { wallLength, type FloorData, type Id } from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, ImagePlus } from 'lucide-react';
import { useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { issueColors } from '@/features/floorplan/canvas/theme';
import { editorStore, useEditorStore } from '@/features/floorplan/editor-store';
import { SUGGESTIONS_TOOL } from '@/features/suggestions/tool';
import { formatDecimal } from '@/features/floorplan/fields/numbers';
import { selectClass } from '@/features/floorplan/fields/select';
import { photoGroups } from './groups';
import { PhotoThumbnail, PhotoViewer } from './photo-viewer';
import { reanalysePhoto, uploadPhoto, usePhotos } from './photos-api';
import { chooseRoom, usePhotosStore, type PhotoAnalysis, type PhotoUpload } from './photos-store';
import { photoRegion, photoTarget, targetRoom, type PhotoTarget } from './target';

const UPLOAD_ACCEPT = 'image/*';

function UploadStatus({ upload }: { upload: PhotoUpload }) {
  const { t } = useTranslation();
  const text =
    upload.step === 'compressing'
      ? t('photos.compressing')
      : upload.step === 'uploading'
        ? t('photos.uploading')
        : upload.step === 'failed'
          ? t(`photos.failed.${upload.reason}`)
          : '';
  return (
    <p
      role="status"
      className="text-sm empty:hidden"
      style={upload.step === 'failed' ? { color: issueColors.error } : undefined}
    >
      {text}
    </p>
  );
}

/** Where the latest analysis is, what it found, or why it stopped (M11 T4). */
function AnalysisStatus({
  analysis,
  photo,
}: {
  analysis: PhotoAnalysis;
  photo: Attachment | undefined;
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const text =
    analysis.step === 'idle'
      ? ''
      : analysis.step === 'done'
        ? analysis.count > 0
          ? t('photos.analysis.done', { count: analysis.count })
          : t('photos.analysis.nothing')
        : analysis.step === 'failed'
          ? t(`photos.analysis.errors.${analysis.error}`)
          : t(`photos.analysis.${analysis.step}`);
  return (
    <div className="flex flex-col gap-2 empty:hidden">
      <p
        role="status"
        className="text-sm empty:hidden"
        style={analysis.step === 'failed' ? { color: issueColors.error } : undefined}
      >
        {text}
      </p>
      {analysis.step === 'done' && analysis.count > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => {
            editorStore.getState().setTool(SUGGESTIONS_TOOL);
          }}
        >
          {t('photos.analysis.review')}
        </Button>
      )}
      {analysis.step === 'failed' && photo && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => void reanalysePhoto(queries, photo)}
        >
          {t('photos.analysis.retry')}
        </Button>
      )}
    </div>
  );
}

/** The room a photo of a wall bordering several rooms is taken in. */
function RoomChoice({
  data,
  target,
  roomId,
}: {
  data: FloorData;
  target: Extract<PhotoTarget, { kind: 'wall' }>;
  roomId: Id;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{t('photos.takenIn')}</Label>
      <select
        id={id}
        className={selectClass}
        value={roomId}
        onChange={(e) => {
          chooseRoom(target.wallId, e.target.value);
        }}
      >
        {target.rooms.map((r) => (
          <option key={r.roomId} value={r.roomId}>
            {data.rooms[r.roomId]?.name ?? r.roomId}
          </option>
        ))}
      </select>
    </div>
  );
}

function PickButtons({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  const { t } = useTranslation();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // Hidden behind the buttons, which open them.
  const input = (
    ref: React.RefObject<HTMLInputElement | null>,
    testId: string,
    capture: boolean,
  ) => (
    <input
      ref={ref}
      type="file"
      accept={UPLOAD_ACCEPT}
      {...(capture ? { capture: 'environment' as const } : {})}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid={testId}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
  return (
    <div className="flex flex-wrap gap-2">
      {input(camera, 'photo-camera', true)}
      {input(picker, 'photo-file', false)}
      <Button disabled={disabled} onClick={() => camera.current?.click()}>
        <Camera aria-hidden />
        {t('photos.take')}
      </Button>
      <Button variant="outline" disabled={disabled} onClick={() => picker.current?.click()}>
        <ImagePlus aria-hidden />
        {t('photos.pick')}
      </Button>
    </div>
  );
}

function groupTitle(
  t: ReturnType<typeof useTranslation>['t'],
  data: FloorData,
  wallId: Id | null,
  selectedWallId: Id | undefined,
) {
  if (wallId === null) return t('photos.general');
  if (wallId === selectedWallId) return t('photos.selectedWall');
  const wall = data.walls[wallId];
  return wall
    ? t('photos.wall', { length: formatDecimal(wallLength(wall), 2) })
    : t('photos.missingWall');
}

/**
 * Photos of the selected room or wall (M11 decision 4): take or pick one, see the room's photos
 * grouped by the wall they show, open one full size or delete it.
 */
export function PhotosPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const titleId = useId();
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const selection = useEditorStore((s) => s.selection);
  const upload = usePhotosStore((s) => s.upload);
  const viewing = usePhotosStore((s) => s.viewing);
  const analysis = usePhotosStore((s) => s.analysis);
  const target = useMemo(
    () => (data ? photoTarget(data, selection) : ({ kind: 'none' } as const)),
    [data, selection],
  );
  const chosen = usePhotosStore((s) =>
    target.kind === 'wall' ? s.roomChoice[target.wallId] : undefined,
  );
  const photos = usePhotos(ctx.floorId);
  const roomId = targetRoom(target, chosen);
  const region = photoRegion(target, chosen);
  const selectedWallId = target.kind === 'wall' ? target.wallId : undefined;
  const groups = useMemo(
    () => (roomId ? photoGroups(photos.data ?? [], roomId, selectedWallId) : []),
    [photos.data, roomId, selectedWallId],
  );
  if (!data) return null;
  const busy = upload.step === 'compressing' || upload.step === 'uploading';
  const shown: Attachment | undefined = photos.data?.find((p) => p.id === viewing);
  const roomName = roomId ? (data.rooms[roomId]?.name ?? '') : '';

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="text-sm font-semibold">
        {t('photos.name')}
      </h2>
      {target.kind === 'none' && (
        <p className="text-sm text-muted-foreground">{t('photos.pickTarget')}</p>
      )}
      {target.kind === 'wall' && target.rooms.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('photos.noRoom')}</p>
      )}
      {target.kind === 'wall' && target.rooms.length > 1 && roomId && (
        <RoomChoice data={data} target={target} roomId={roomId} />
      )}
      {region && (
        <>
          <p className="text-sm">
            {target.kind === 'wall'
              ? t('photos.ofWall', { room: roomName })
              : t('photos.ofRoom', { room: roomName })}
          </p>
          <PickButtons
            disabled={busy}
            onFile={(file) => void uploadPhoto(queries, file, ctx.floorId, region)}
          />
        </>
      )}
      <UploadStatus upload={upload} />
      <AnalysisStatus
        analysis={analysis}
        photo={
          analysis.step === 'idle' ? undefined : photos.data?.find((p) => p.id === analysis.photoId)
        }
      />
      {photos.isError && (
        <p className="text-sm" style={{ color: issueColors.error }}>
          {t('common.loadFailed')}
        </p>
      )}
      {groups.map((group) => {
        const title = groupTitle(t, data, group.wallId, selectedWallId);
        return (
          <section key={group.wallId ?? ''} aria-label={title} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
            {group.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('photos.none')}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {group.photos.map((photo, i) => (
                  <li key={photo.id}>
                    <PhotoThumbnail photo={photo} label={t('photos.open', { n: i + 1 })} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {shown && <PhotoViewer photo={shown} />}
    </section>
  );
}
