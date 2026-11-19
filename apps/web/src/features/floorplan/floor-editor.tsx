import type { Id } from '@el-karta/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useModelStore } from '@/model/store';
import { EditorWorkspace } from './canvas/editor-workspace';
import { extensions } from './extensions';

/** The editor for one floor of the project in the model store. */
export function FloorEditor({ floorId, backTo }: { floorId: Id; backTo: string }) {
  const { t } = useTranslation();
  const floor = useModelStore((s) => s.model?.floors[floorId]);

  if (!floor) return <p className="text-destructive">{t('editor.floorNotFound')}</p>;

  return (
    <div className="flex h-[calc(100dvh-10rem)] min-h-96 flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to={backTo} className="text-sm text-muted-foreground hover:underline">
          {t('editor.back')}
        </Link>
        <h1 className="font-semibold">{floor.name}</h1>
      </header>
      <EditorWorkspace floorId={floorId} extensions={extensions} />
    </div>
  );
}
