import type { Attachment } from '@el-karta/data-supabase';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { issueColors } from '@/features/floorplan/canvas/theme';
import { deletePhoto, reanalysePhoto, usePhotoUrl } from './photos-api';
import { usePhotosStore, viewPhoto } from './photos-store';

/** A photo's image, signed again once if the URL has stopped working. */
function PhotoImage({
  photo,
  alt,
  className,
}: {
  photo: Attachment;
  alt: string;
  className: string;
}) {
  const { url, failed, retry } = usePhotoUrl(photo.id);
  const retried = useRef(false);
  const { t } = useTranslation();
  if (failed)
    return <span className="text-xs text-muted-foreground">{t('photos.imageFailed')}</span>;
  if (!url) return <span className={`${className} block animate-pulse bg-muted`} />;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        if (retried.current) return;
        retried.current = true;
        retry();
      }}
    />
  );
}

export function PhotoThumbnail({ photo, label }: { photo: Attachment; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="block aspect-square w-full overflow-hidden rounded-md border bg-muted"
      onClick={() => {
        viewPhoto(photo.id);
      }}
    >
      <PhotoImage photo={photo} alt="" className="size-full object-cover" />
    </button>
  );
}

/** The photo at full size, with a new analysis and delete. Deleting asks first. */
export function PhotoViewer({ photo }: { photo: Attachment }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const analysing = usePhotosStore(
    (s) =>
      s.analysis.step !== 'idle' &&
      s.analysis.step !== 'done' &&
      s.analysis.step !== 'failed' &&
      s.analysis.photoId === photo.id,
  );

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={t('photos.viewer')}
      className="m-auto max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] rounded-xl bg-background p-3 backdrop:bg-black/70"
      // Not `onClose`: closing on unmount (twice under StrictMode) fires it too.
      onCancel={(e) => {
        e.preventDefault();
        viewPhoto(null);
      }}
    >
      <div className="flex flex-col gap-3">
        <PhotoImage
          photo={photo}
          alt={t('photos.viewer')}
          className="max-h-[calc(100dvh-7rem)] w-auto max-w-full object-contain"
        />
        {failed && (
          <p role="alert" className="text-sm" style={{ color: issueColors.error }}>
            {t('photos.deleteFailed')}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            disabled={analysing}
            onClick={() => {
              void reanalysePhoto(queries, photo);
              viewPhoto(null);
            }}
          >
            <RefreshCw aria-hidden />
            {t('photos.analysis.rerun')}
          </Button>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              if (!window.confirm(t('photos.confirmDelete'))) return;
              setDeleting(true);
              setFailed(false);
              deletePhoto(queries, photo).then(
                () => {
                  viewPhoto(null);
                },
                () => {
                  setDeleting(false);
                  setFailed(true);
                },
              );
            }}
          >
            <Trash2 aria-hidden />
            {t('photos.delete')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              viewPhoto(null);
            }}
          >
            <X aria-hidden />
            {t('photos.close')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
