import { putDevice, type Device, type Edit } from '@el-karta/core';

/** One undoable edit that stores `after` over the device with its id, optional fields included. */
export function storeDevice(after: Device): Edit {
  return putDevice(after);
}
