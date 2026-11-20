import {
  combine,
  setBackground,
  setScale,
  type BackgroundPlacement,
  type FloorScale,
} from '@el-karta/core';
import { LoaderCircle, RotateCw, Ruler, Trash2, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { modelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { editorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { backgroundUi, type UploadStep } from './background-store';
import { DecimalField } from '../fields/decimal-field';
import { readyImageSize, reloadImage, useBackgroundImage } from './images';
import type { PdfFile } from './pdf';
import { PLAN_FILE_ACCEPT } from './plan-file';
import { placeBackground, rotatedAboutCenter } from './placement';
import { ScaleInfo } from './scale-info';
import { SCALE_TOOL } from './tools';
import { cancelUpload, startPlanUpload, uploadPdfPage } from './upload';
import { useShownBackground } from './use-placement';

const THUMBNAIL_PX = 240;

/** Upload, page choice, opacity, position, rotation and scale of the floor's plan image. */
export function BackgroundPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const titleId = useId();
  const upload = useStore(backgroundUi, (s) => s.upload);
  const { background, scale, placement } = useShownBackground(ctx.floorId);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = ['reading', 'rendering', 'uploading'].includes(upload.step);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="font-semibold">
        {t('background.title')}
      </h2>
      <input
        ref={fileInput}
        type="file"
        accept={PLAN_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('background.chooseFile')}
        data-testid="background-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void startPlanUpload(file, ctx);
        }}
      />
      <UploadStatus upload={upload} />
      {upload.step === 'pick-page' ? (
        <PdfPagePicker pdf={upload.pdf} ctx={ctx} />
      ) : (
        <>
          {!background && <p className="text-sm text-muted-foreground">{t('background.empty')}</p>}
          <Button
            variant={background ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden />
            {background ? t('background.replace') : t('background.chooseFile')}
          </Button>
        </>
      )}
      {background && placement && (
        <BackgroundSettings
          ctx={ctx}
          attachmentId={background.attachmentId}
          pdfPage={background.pdfPage}
          placement={placement}
          scale={scale}
        />
      )}
    </section>
  );
}

function UploadStatus({ upload }: { upload: UploadStep }) {
  const { t } = useTranslation();
  if (upload.step === 'idle' || upload.step === 'pick-page') return null;
  if (upload.step === 'failed') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`background.failed.${upload.reason}`)}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {upload.step === 'rendering'
        ? t('background.rendering', { page: upload.page })
        : t(`background.${upload.step}`)}
    </p>
  );
}

function PdfPagePicker({ pdf, ctx }: { pdf: PdfFile; ctx: CanvasContext }) {
  const { t } = useTranslation();
  const [thumbnails, setThumbnails] = useState<Readonly<Record<number, string>>>({});
  const pages = Array.from({ length: pdf.pageCount }, (_, i) => i + 1);

  useEffect(() => {
    const abort = new AbortController();
    const stopped = () => abort.signal.aborted;
    void (async () => {
      for (let page = 1; page <= pdf.pageCount && !stopped(); page++) {
        const url = await pdf.thumbnail(page, THUMBNAIL_PX).catch(() => null);
        if (url && !stopped()) setThumbnails((s) => ({ ...s, [page]: url }));
      }
    })();
    return () => {
      abort.abort();
    };
  }, [pdf]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{t('background.pickPage', { count: pdf.pageCount })}</p>
      <ul className="grid grid-cols-3 gap-2 md:grid-cols-2">
        {pages.map((page) => (
          <li key={page}>
            <button
              type="button"
              aria-label={t('background.page', { page })}
              className="flex w-full flex-col items-center gap-1 rounded-md border p-1 text-xs hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => void uploadPdfPage(pdf, page, ctx)}
            >
              {thumbnails[page] ? (
                <img src={thumbnails[page]} alt="" className="max-h-32 w-full object-contain" />
              ) : (
                <span className="aspect-[3/4] w-full animate-pulse rounded bg-muted" />
              )}
              {page}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={cancelUpload}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}

function BackgroundSettings({
  ctx,
  attachmentId,
  pdfPage,
  placement,
  scale,
}: {
  ctx: CanvasContext;
  attachmentId: string;
  pdfPage: number | undefined;
  placement: BackgroundPlacement;
  scale: FloorScale | undefined;
}) {
  const { t } = useTranslation();
  const opacityId = useId();
  const image = useBackgroundImage(attachmentId);
  const opacity = useStore(backgroundUi, (s) => s.opacity);

  const place = (next: Pick<BackgroundPlacement, 'offset' | 'rotation'>) => {
    const floor = modelStore.getState().model?.floors[ctx.floorId];
    const edit = floor && placeBackground(ctx.floorId, floor.data, next);
    if (edit) modelStore.getState().apply(edit);
  };
  const rotate = (rotation: number) => {
    place(rotatedAboutCenter(placement, rotation, readyImageSize(attachmentId)));
  };

  return (
    <div className="flex flex-col gap-3">
      {pdfPage !== undefined && (
        <p className="text-sm text-muted-foreground">
          {t('background.pdfPage', { page: pdfPage })}
        </p>
      )}
      {image?.status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('background.imageLoading')}
        </p>
      )}
      {image?.status === 'failed' && (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {t('background.imageFailed')}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              reloadImage(attachmentId);
            }}
          >
            {t('background.retry')}
          </Button>
        </div>
      )}
      <div className="grid gap-1">
        <label htmlFor={opacityId} className="text-sm font-medium">
          {t('background.opacity', { percent: Math.round(opacity * 100) })}
        </label>
        <input
          id={opacityId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          className="w-full accent-primary"
          onChange={(e) => {
            backgroundUi.setState({ opacity: Number(e.target.value) / 100 });
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <ScaleInfo scale={scale} />
        <Button
          variant="outline"
          onClick={() => {
            editorStore.getState().setTool(SCALE_TOOL);
          }}
        >
          <Ruler aria-hidden />
          {t('background.measure')}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t('background.placeHint')}</p>
      <div className="grid grid-cols-3 gap-2">
        <DecimalField
          label={t('background.x')}
          unit={t('fields.metres')}
          value={placement.offset.x}
          digits={3}
          signed
          onCommit={(x) => {
            place({ ...placement, offset: { ...placement.offset, x } });
          }}
        />
        <DecimalField
          label={t('background.y')}
          unit={t('fields.metres')}
          value={placement.offset.y}
          digits={3}
          signed
          onCommit={(y) => {
            place({ ...placement, offset: { ...placement.offset, y } });
          }}
        />
        <DecimalField
          label={t('background.rotation')}
          unit={t('background.degrees')}
          value={placement.rotation}
          digits={1}
          signed
          onCommit={rotate}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            rotate(placement.rotation + 90);
          }}
        >
          <RotateCw aria-hidden />
          {t('background.rotate90')}
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            modelStore
              .getState()
              .apply(combine(setBackground(ctx.floorId, null), setScale(ctx.floorId, null)));
          }}
        >
          <Trash2 aria-hidden />
          {t('background.remove')}
        </Button>
      </div>
    </div>
  );
}
