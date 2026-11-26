import type { PluginRegistry } from './registry.ts';

/** One device type the photo pass may report, as plain data for its input (M11 decision 5). */
export interface PhotoDetectable {
  domain: string;
  type: string;
  description: string;
  placement: 'wall' | 'ceiling';
  /** Metres above the floor, for wall types placed without a measured height. */
  defaultHeight?: number;
  visibleProps?: Record<string, string[]>;
  countable?: boolean;
  /** The type's default ports, so a detected device gets the same ports as one placed by hand. */
  ports: { kind: string; domain: string }[];
}

/**
 * Every type a plugin's `aiHints.photo` names, with a wall or ceiling placement (wall first when
 * both are allowed). Hints for unknown types, or types that only stand on the floor, are skipped.
 */
export function photoDetectables(registry: PluginRegistry): PhotoDetectable[] {
  const found: PhotoDetectable[] = [];
  for (const plugin of registry.plugins) {
    for (const hint of plugin.aiHints?.photo ?? []) {
      const def = registry.deviceType(plugin.id, hint.type);
      const placement = def?.placements.includes('wall')
        ? 'wall'
        : def?.placements.includes('ceiling')
          ? 'ceiling'
          : null;
      if (!def || !placement) continue;
      found.push({
        domain: plugin.id,
        type: hint.type,
        description: hint.description,
        placement,
        ports: def.defaultPorts.map((port) => ({
          kind: port.kind,
          domain: port.domain ?? plugin.id,
        })),
        ...(def.defaultHeight === undefined ? {} : { defaultHeight: def.defaultHeight }),
        ...(hint.visibleProps === undefined
          ? {}
          : {
              visibleProps: Object.fromEntries(
                Object.entries(hint.visibleProps).map(([k, v]) => [k, [...v]]),
              ),
            }),
        ...(hint.countable === undefined ? {} : { countable: hint.countable }),
      });
    }
  }
  return found;
}
