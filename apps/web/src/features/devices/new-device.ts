import type { Device, DeviceTypeDef, Id, Placement, Port, PortDef } from '@el-karta/core';

/** Where a new or moved device goes: its placement, and the room it is in or faces. */
export interface DeviceSite {
  placement: Exclude<Placement, { kind: 'container' }>;
  roomId?: Id | undefined;
}

/** A device type with the domain that registers it. */
export interface DeviceTypeRef {
  domain: string;
  def: DeviceTypeDef;
}

/** Ports of a device of `domain` made from port definitions, each with a fresh id. */
export const portsFrom = (
  domain: string,
  defs: readonly PortDef[],
  newId: () => Id = () => crypto.randomUUID(),
): Port[] =>
  defs.map((port) => ({
    id: newId(),
    domain: port.domain ?? domain,
    kind: port.kind,
  }));

/**
 * A new, manually placed device of a registered type at `site`, with the type's default ports and
 * no props or count, since nobody has said what they are yet.
 */
export function newDevice(type: DeviceTypeRef, id: Id, site: DeviceSite, newId?: () => Id): Device {
  return {
    id,
    domain: type.domain,
    type: type.def.type,
    label: '',
    ...(site.roomId === undefined ? {} : { roomId: site.roomId }),
    placement: site.placement,
    props: {},
    ports: portsFrom(type.domain, type.def.defaultPorts, newId),
    provenance: { status: 'manual' },
  };
}
