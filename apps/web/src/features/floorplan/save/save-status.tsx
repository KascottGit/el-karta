import { CircleCheck, CloudAlert, CloudUpload, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { modelStore, useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { hasUnsavedChanges, type Autosave } from './autosave';
import { useAutosave } from './autosave-context';
import { conflictMessage } from './conflict-text';
import { describeConflict, dismissConflicts } from './conflicts';

/** Saved / saving / not saved, with a retry, and the list of changes that could not be saved. Renders nothing without autosave. */
export function SaveStatus() {
  const autosave = useAutosave();
  return autosave ? <AutosaveStatusView autosave={autosave} /> : null;
}

function AutosaveStatusView({ autosave }: { autosave: Autosave }) {
  const { t } = useTranslation();
  const saving = useModelStore((s) => s.saving);
  const unsaved = useModelStore(hasUnsavedChanges);
  const failed = useStore(autosave.status, (s) => s.failures > 0);

  const state = saving ? 'saving' : failed && unsaved ? 'failed' : unsaved ? 'unsaved' : 'saved';
  const Icon = {
    saving: LoaderCircle,
    failed: CloudAlert,
    unsaved: CloudUpload,
    saved: CircleCheck,
  }[state];

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        role="status"
        className={
          state === 'failed'
            ? 'flex items-center gap-1 text-destructive'
            : 'flex items-center gap-1 text-muted-foreground'
        }
      >
        <Icon aria-hidden className={state === 'saving' ? 'size-4 animate-spin' : 'size-4'} />
        {t(`save.${state}`)}
      </span>
      {state === 'failed' && (
        <Button variant="outline" size="sm" onClick={autosave.retry}>
          {t('save.retry')}
        </Button>
      )}
      <Conflicts autosave={autosave} />
      {state === 'failed' && (
        <span className="basis-full text-xs text-muted-foreground">{t('save.failedHint')}</span>
      )}
    </div>
  );
}

function Conflicts({ autosave }: { autosave: Autosave }) {
  const { t } = useTranslation();
  const conflicts = useModelStore((s) => s.conflicts);
  const descriptions = useStore(autosave.status, (s) => s.conflictDescriptions);
  if (conflicts.length === 0) return null;

  const model = modelStore.getState().model;
  const items = conflicts.map(
    (c) => descriptions[c.change.id] ?? describeConflict(c, undefined, [model]),
  );

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="destructive" size="sm">
          <TriangleAlert aria-hidden />
          {t('save.conflicts.button', { count: conflicts.length })}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={16}
          className="z-50 w-[min(24rem,calc(100vw-2rem))] space-y-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-md"
        >
          <h2 className="font-semibold">{t('save.conflicts.title')}</h2>
          <p className="text-muted-foreground">{t('save.conflicts.explanation')}</p>
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-md border">
            {items.map((item) => (
              <li key={item.changeId} className="flex items-start gap-2 p-2">
                <div className="flex-1">
                  <p>{conflictMessage(t, item)}</p>
                  {item.floorName !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {t('save.conflicts.onFloor', { floor: item.floorName })}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    dismissConflicts(modelStore, [item.changeId]);
                  }}
                >
                  {t('save.conflicts.dismiss')}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              dismissConflicts(modelStore);
            }}
          >
            {t('save.conflicts.dismissAll')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
