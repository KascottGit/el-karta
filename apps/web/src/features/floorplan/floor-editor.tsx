import type { Id } from '@el-karta/core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FloorSwitcher } from '@/features/projects/floor-switcher';
import { useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { EditorWorkspace } from './canvas/editor-workspace';
import { extensions } from './extensions';
import { SaveStatus } from './save/save-status';
import { useViewMode, VIEW_MODES } from './view-mode';

/** 2D, 3D, or both side by side; the side-by-side mode only on screens `md` and wider. */
function ViewSwitch() {
  const { t } = useTranslation();
  const [mode, setMode] = useViewMode();
  return (
    <div
      role="group"
      aria-label={t('view3d.viewMode.label')}
      className="flex items-center gap-0.5 rounded-lg border p-0.5"
    >
      {VIEW_MODES.map((m) => (
        <Button
          key={m}
          size="sm"
          variant={mode === m ? 'default' : 'ghost'}
          aria-pressed={mode === m}
          className={m === 'split' ? 'hidden md:inline-flex' : undefined}
          onClick={() => {
            setMode(m);
          }}
        >
          {t(`view3d.viewMode.${m}`)}
        </Button>
      ))}
    </div>
  );
}

/**
 * The editor for one floor of the project in the model store. Memoized, since the pages around it
 * re-render on every edit and the editor's parts subscribe to what they show themselves.
 */
export const FloorEditor = memo(function FloorEditor({
  floorId,
  backTo,
  onOpenFloor,
}: {
  floorId: Id;
  backTo: string;
  /** Opens another floor: a new URL, keeping the search parameters (the view mode). */
  onOpenFloor: (floorId: Id) => void;
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
        <FloorSwitcher floorId={floorId} onOpenFloor={onOpenFloor} />
        <ViewSwitch />
        <div className="ml-auto">
          <SaveStatus />
        </div>
      </header>
      <EditorWorkspace floorId={floorId} extensions={extensions} onOpenFloor={onOpenFloor} />
    </div>
  );
});
