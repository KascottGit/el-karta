import type { Device, Id } from '../schemas/index.ts';
import type { ConnectionKindDef, DeviceTypeDef, DomainPlugin } from './types.ts';

export interface PluginRegistry {
  readonly plugins: readonly DomainPlugin[];
  plugin(id: string): DomainPlugin | undefined;
  deviceType(domain: string, type: string): DeviceTypeDef | undefined;
  connectionKind(domain: string, kind: string): ConnectionKindDef | undefined;
  traceKinds(domain: string): ReadonlySet<string>;
  /** Ports reachable inside a device from `entryPortId`, or null when every port is joined. */
  linkedPorts(device: Device, entryPortId: Id): ReadonlySet<Id> | null;
}

export class RegistryError extends Error {
  override name = 'RegistryError';
}

const indexBy = <T>(
  items: readonly T[],
  key: (item: T) => string,
  what: string,
): Map<string, T> => {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) throw new RegistryError(`Duplicate ${what}: ${k}`);
    map.set(k, item);
  }
  return map;
};

export function createRegistry(plugins: readonly DomainPlugin[]): PluginRegistry {
  const byId = indexBy(plugins, (p) => p.id, 'plugin id');
  const deviceTypes = new Map(
    plugins.map((p) => [p.id, indexBy(p.deviceTypes, (d) => d.type, `device type in ${p.id}`)]),
  );
  const connectionKinds = new Map(
    plugins.map((p) => [
      p.id,
      indexBy(p.connectionKinds, (c) => c.kind, `connection kind in ${p.id}`),
    ]),
  );
  const traceKinds = new Map(plugins.map((p) => [p.id, new Set(p.traceKinds)]));
  const empty: ReadonlySet<string> = new Set();
  const linkCache = new WeakMap<Device, Map<Id, Set<Id>> | null>();

  function portLinkMap(device: Device): Map<Id, Set<Id>> | null {
    const cached = linkCache.get(device);
    if (cached !== undefined) return cached;
    const def = deviceTypes.get(device.domain)?.get(device.type);
    let map: Map<Id, Set<Id>> | null = null;
    if (def?.portLinks) {
      map = new Map();
      for (const [a, b] of def.portLinks(device)) {
        map.set(a, (map.get(a) ?? new Set()).add(b));
        map.set(b, (map.get(b) ?? new Set()).add(a));
      }
    }
    linkCache.set(device, map);
    return map;
  }

  return {
    plugins,
    plugin: (id) => byId.get(id),
    deviceType: (domain, type) => deviceTypes.get(domain)?.get(type),
    connectionKind: (domain, kind) => connectionKinds.get(domain)?.get(kind),
    traceKinds: (domain) => traceKinds.get(domain) ?? empty,
    linkedPorts(device, entryPortId) {
      const map = portLinkMap(device);
      return map ? (map.get(entryPortId) ?? new Set()) : null;
    },
  };
}
