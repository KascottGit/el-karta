import {
  addBuilding,
  buildingsInOrder,
  floorsInOrder,
  newFloor,
  removeBuilding,
  reorderFloors,
  updateBuilding,
  updateFloor,
  type Building,
  type FloorRecord,
  type Model,
} from '@el-karta/core';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/ui/button';
import { InlineRename } from './inline-rename';
import { applyAndSave, useCreateFloor, useDeleteFloor } from './queries';

/** Floors per building, highest first like a building section, with add, rename, reorder and delete. */
export function FloorManager({ model }: { model: Model }) {
  const { t } = useTranslation();
  const buildings = buildingsInOrder(model);
  const floorCount = Object.keys(model.floors).length;

  const onAddBuilding = () => {
    applyAndSave(
      addBuilding({
        id: crypto.randomUUID(),
        name: t('project.newBuildingName', { number: buildings.length + 1 }),
      }),
    );
  };

  return (
    <section className="space-y-4">
      <h2 className="font-semibold">{t('project.floors')}</h2>
      {buildings.map((building) => (
        <BuildingFloors
          key={building.id}
          model={model}
          building={building}
          showHeading={buildings.length > 1}
          canDeleteFloors={floorCount > 1}
        />
      ))}
      <Button variant="outline" size="sm" onClick={onAddBuilding}>
        <Plus />
        {t('project.addBuilding')}
      </Button>
    </section>
  );
}

function BuildingFloors({
  model,
  building,
  showHeading,
  canDeleteFloors,
}: {
  model: Model;
  building: Building;
  showHeading: boolean;
  canDeleteFloors: boolean;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const create = useCreateFloor();
  const bottomUp = floorsInOrder(model, building.id);

  const move = (floor: FloorRecord, by: 1 | -1) => {
    const order = bottomUp.map((f) => f.id);
    const from = order.indexOf(floor.id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    applyAndSave(reorderFloors(order));
  };

  const onAddFloor = () => {
    create.mutate(
      newFloor(model, {
        id: crypto.randomUUID(),
        buildingId: building.id,
        name: t('project.newFloorName', { number: bottomUp.length + 1 }),
      }),
    );
  };

  return (
    <div className="space-y-2">
      {showHeading && (
        <div className="flex min-h-8 items-center gap-1">
          {renaming ? (
            <InlineRename
              value={building.name}
              label={t('project.buildingName')}
              onSave={(name) => {
                applyAndSave(updateBuilding(building.id, { name }));
              }}
              onDone={() => {
                setRenaming(false);
              }}
            />
          ) : (
            <>
              <h3 className="flex-1 text-sm font-medium">{building.name}</h3>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('project.rename', { name: building.name })}
                onClick={() => {
                  setRenaming(true);
                }}
              >
                <Pencil />
              </Button>
              {bottomUp.length === 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('project.removeBuilding', { name: building.name })}
                  onClick={() => {
                    applyAndSave(removeBuilding(building.id));
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {bottomUp.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('project.noFloors')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {bottomUp
            .map((floor, index) => (
              <FloorRow
                key={floor.id}
                floor={floor}
                canMoveUp={index < bottomUp.length - 1}
                canMoveDown={index > 0}
                canDelete={canDeleteFloors}
                onMove={(by) => {
                  move(floor, by);
                }}
              />
            ))
            .reverse()}
        </ul>
      )}
      {create.isError && <p className="text-sm text-destructive">{t('project.addFloorFailed')}</p>}
      <Button variant="outline" size="sm" onClick={onAddFloor} disabled={create.isPending}>
        <Plus />
        {t('project.addFloor')}
      </Button>
    </div>
  );
}

function FloorRow({
  floor,
  canMoveUp,
  canMoveDown,
  canDelete,
  onMove,
}: {
  floor: FloorRecord;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onMove: (by: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'view' | 'rename' | 'confirmDelete'>('view');
  const remove = useDeleteFloor();
  const name = floor.name;

  if (mode === 'rename') {
    return (
      <li className="flex px-2 py-2">
        <InlineRename
          value={name}
          label={t('project.floorName')}
          onSave={(next) => {
            applyAndSave(updateFloor(floor.id, { name: next }));
          }}
          onDone={() => {
            setMode('view');
          }}
        />
      </li>
    );
  }

  if (mode === 'confirmDelete') {
    return (
      <li
        className="space-y-2 px-4 py-3"
        role="alertdialog"
        aria-label={t('project.deleteFloor', { name })}
      >
        <p className="text-sm">{t('project.confirmDeleteFloor', { name })}</p>
        {remove.isError && (
          <p className="text-sm text-destructive">{t('project.deleteFloorFailed')}</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(floor.id);
            }}
          >
            {t('project.confirmDelete')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode('view');
            }}
          >
            {t('common.cancel')}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-1 py-1 pr-2">
      <Link
        to={`/projects/${floor.projectId}/floors/${floor.id}`}
        className="flex min-w-0 flex-1 justify-between gap-2 px-4 py-2 hover:bg-muted"
      >
        <span className="truncate">{name}</span>
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {t('project.deviceCount', { count: Object.keys(floor.data.devices).length })}
        </span>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('project.rename', { name })}
        onClick={() => {
          setMode('rename');
        }}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('project.moveUp', { name })}
        disabled={!canMoveUp}
        onClick={() => {
          onMove(1);
        }}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('project.moveDown', { name })}
        disabled={!canMoveDown}
        onClick={() => {
          onMove(-1);
        }}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('project.deleteFloor', { name })}
        title={canDelete ? undefined : t('project.lastFloor')}
        disabled={!canDelete}
        onClick={() => {
          setMode('confirmDelete');
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
