import { PlugZap } from 'lucide-react';
import { deviceTool } from '@/features/devices/device-tool';
import { powerType } from './power-edits';
import { powerStore } from './power-store';

/**
 * Places an outlet, switch or light of the type chosen in the side panel: wall types on the
 * nearest wall face within reach, at the type's default height; ceiling lights in the room tapped.
 */
export const powerTool = deviceTool({
  id: 'power',
  label: 'power.tool',
  icon: PlugZap,
  order: 41,
  shortcut: 'e',
  chosenType: () => powerType(powerStore.getState().type),
  setPreview: (preview) => {
    powerStore.setState({ preview });
  },
  setMissed: (missed) => {
    powerStore.setState({ missed });
  },
});
