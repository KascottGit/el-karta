import { FURNISHING_DOMAIN, isFurnitureType, newFurniture } from '@el-karta/plugin-furnishing';
import { Sofa } from 'lucide-react';
import { registry } from '@/plugins';
import { deviceTool } from '@/features/devices/device-tool';
import { newDevice } from '@/features/devices/new-device';
import { furnishingStore } from './furnishing-store';

/**
 * Places a piece of furniture of the type chosen in the side panel at its default size, centred
 * where it is tapped, in the room under that point (the shared device tool's floor placement).
 */
export const furnitureTool = deviceTool({
  id: 'furniture',
  label: 'furnishing.tool',
  icon: Sofa,
  order: 40,
  shortcut: 'u',
  chosenType: () => {
    const def = registry.deviceType(FURNISHING_DOMAIN, furnishingStore.getState().type);
    return def && { domain: FURNISHING_DOMAIN, def };
  },
  create: (type, id, site) => {
    const furniture = type.def.type;
    return site.placement.kind === 'floor' && isFurnitureType(furniture)
      ? newFurniture({ id, type: furniture, at: site.placement.at, roomId: site.roomId })
      : newDevice(type, id, site);
  },
  setPreview: (preview) => {
    furnishingStore.setState({ preview });
  },
});
