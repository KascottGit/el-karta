import type { Id } from '@el-karta/core';
import { Layers, Maximize } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { buildingFloors, view3dStore, visibleFloors, useView3dStore } from './floor-visibility';

/** The floor menu (which floors, exploded) and zoom to fit, over the 3D view. */
export function View3dControls({ floorId }: { floorId: Id }) {
  const { t } = useTranslation();
  const model = useModelStore((s) => s.model);
  const choice = useView3dStore((s) => s.floors);
  const exploded = useView3dStore((s) => s.exploded);
  const name = useId();
  const floors = model ? buildingFloors(model, floorId) : [];
  const { setFloors, setExploded, requestFit } = view3dStore.getState();
  const shown = new Set(model ? visibleFloors(model, floorId, choice).map((f) => f.id) : []);

  const toggle = (id: Id, on: boolean) => {
    const ids = floors.filter((f) => (f.id === id ? on : shown.has(f.id))).map((f) => f.id);
    setFloors({ kind: 'some', ids });
  };

  return (
    <div className="absolute top-2 left-2 z-10 flex gap-1">
      {floors.length > 1 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="outline" size="sm">
              <Layers aria-hidden />
              {t('view3d.floors.button')}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              collisionPadding={16}
              className="z-50 w-[min(16rem,calc(100vw-2rem))] space-y-3 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md"
            >
              <fieldset className="space-y-1">
                <legend className="mb-1 font-medium">{t('view3d.floors.button')}</legend>
                {(['current', 'all', 'some'] as const).map((kind) => (
                  <label key={kind} className="flex min-h-8 items-center gap-2">
                    <input
                      type="radio"
                      name={name}
                      className="size-4"
                      checked={choice.kind === kind}
                      onChange={() => {
                        setFloors(kind === 'some' ? { kind, ids: [...shown] } : { kind });
                      }}
                    />
                    {t(`view3d.floors.${kind}`)}
                  </label>
                ))}
                {choice.kind === 'some' && (
                  <div className="space-y-1 pl-6">
                    {[...floors].reverse().map((floor) => (
                      <label key={floor.id} className="flex min-h-8 items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={shown.has(floor.id)}
                          onChange={(e) => {
                            toggle(floor.id, e.target.checked);
                          }}
                        />
                        {floor.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <label className="flex min-h-8 items-center gap-2 border-t pt-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={exploded}
                  onChange={(e) => {
                    setExploded(e.target.checked);
                  }}
                />
                {t('view3d.floors.exploded')}
              </label>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t('view3d.zoomToFit')}
        title={t('view3d.zoomToFit')}
        onClick={requestFit}
      >
        <Maximize aria-hidden />
      </Button>
    </div>
  );
}
