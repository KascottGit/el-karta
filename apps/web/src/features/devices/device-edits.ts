import { updateDevice, type Device, type Edit } from '@el-karta/core';

/** One undoable edit that stores `after` over the device with its id. */
export function storeDevice(after: Device): Edit {
  const { id, ...changes } = after;
  return updateDevice(id, changes);
}
