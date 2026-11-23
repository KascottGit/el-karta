import type { Id } from '@el-karta/core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FloorSwitcher } from '@/features/projects/floor-switcher';
import { useModelStore } from '@/model/store';
import { EditorWorkspace } from './canvas/editor-workspace';
import { extensions } from './extensions';
import { SaveStatus } from './save/save-status';

/**
 * The editor for one floor of the project in the model store. Memoized, since the pages around it
 * re-render on every edit and the editor's parts subscribe to what they show themselves.
 */
export const FloorEditor = memo(function FloorEditor({
  floorId,
  backTo,
}: {
  floorId: Id;
  backTo: string;
}) {
  const { t } = useTranslation();
  // Only the name, so that edits to the floor do not re-render the workspace.
  const name = useModelStore((s) => s.model?.floors[floorId]?.name);

  if (name === undefined) {
    return <p className="p-4 text-destructive">{t('editor.floorNotFound')}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 pb-2">
        <Link to={backTo} className="text-sm text-muted-foreground hover:underline">
          {t('editor.back')}
        </Link>
        <h1 className="font-semibold">{name}</h1>
        <FloorSwitcher floorId={floorId} />
        <div className="ml-auto">
          <SaveStatus />
        </div>
      </header>
      <EditorWorkspace floorId={floorId} extensions={extensions} />
    </div>
  );
});
