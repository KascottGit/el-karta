import { floorsInOrder, type Building, type Id } from '@el-karta/core';
import { useTranslation } from 'react-i18next';
import { useModelStore } from '@/model/store';
import { buildingsInOrder } from './buildings';

/** Switches the editor to another floor through the page's `onOpenFloor`. */
export function FloorSwitcher({
  floorId,
  onOpenFloor,
}: {
  floorId: Id;
  onOpenFloor: (floorId: Id) => void;
}) {
  const { t, i18n } = useTranslation();
  const model = useModelStore((s) => s.model);

  if (!model || Object.keys(model.floors).length < 2) return null;
  const buildings = buildingsInOrder(model, i18n.language);
  const options = (building: Building) =>
    floorsInOrder(model, building.id)
      .reverse()
      .map((floor) => (
        <option key={floor.id} value={floor.id}>
          {floor.name}
        </option>
      ));

  return (
    <select
      aria-label={t('editor.floor')}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
      value={floorId}
      onChange={(event) => {
        onOpenFloor(event.target.value);
      }}
    >
      {buildings.length > 1
        ? buildings.map((building) => (
            <optgroup key={building.id} label={building.name}>
              {options(building)}
            </optgroup>
          ))
        : buildings.flatMap(options)}
    </select>
  );
}
