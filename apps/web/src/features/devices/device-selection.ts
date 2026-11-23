import type { Device, FloorRecord } from '@el-karta/core';
import type { ModelState } from '@/model/store';
import type { EditorState } from '@/features/floorplan/editor-store';

export const hasDeviceSelected = (editor: EditorState, model: ModelState) => {
  const devices = editor.floorId ? model.model?.floors[editor.floorId]?.data.devices : undefined;
  return !!devices && editor.selection.some((s) => s.collection === 'devices' && s.id in devices);
};

/** The room a device belongs to, or whose ceiling it hangs from. */
export function deviceRoomName(floor: FloorRecord, device: Device): string | undefined {
  const { placement } = device;
  const roomId = device.roomId ?? (placement.kind === 'ceiling' ? placement.roomId : undefined);
  return roomId === undefined ? undefined : floor.data.rooms[roomId]?.name;
}
