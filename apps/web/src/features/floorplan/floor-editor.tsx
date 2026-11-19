import type { Id } from '@el-karta/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useModelStore } from '@/model/store';
import { SaveStatus } from './save/save-status';

/** The editor for one floor of the project in the model store. Canvas, tools and panels arrive in M3 T1+. */
export function FloorEditor({ floorId, backTo }: { floorId: Id; backTo: string }) {
  const { t } = useTranslation();
  const floor = useModelStore((s) => s.model?.floors[floorId]);

  if (!floor) return <p className="text-destructive">{t('editor.floorNotFound')}</p>;

  return (
    <div className="flex h-full min-h-[60dvh] flex-col gap-2">
      <header className="flex items-center gap-4">
        <Link to={backTo} className="text-sm text-muted-foreground hover:underline">
          {t('editor.back')}
        </Link>
        <h1 className="font-semibold">{floor.name}</h1>
        <SaveStatus />
      </header>
      <div data-testid="floor-editor-canvas" className="flex-1 rounded-lg border" />
    </div>
  );
}
