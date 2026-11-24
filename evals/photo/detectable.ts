import type { PhotoDetectableInput } from '@el-karta/ai-passes';

const ports = (...kinds: string[]) => kinds.map((kind) => ({ kind, domain: 'power' }));

/**
 * What the app sends as `PhotoInput.detectable` (`photoDetectables(registry)`). Evals may not
 * import plugins, so this is a copy; a web test (`floorplan/dev/floor-export.test.ts`) fails as
 * soon as it differs from the app's registry.
 */
export const photoDetectable: readonly PhotoDetectableInput[] = [
  {
    domain: 'power',
    type: 'outlet',
    description:
      'Wall socket outlet (Schuko type F in Sweden), usually low on the wall or above a kitchen counter. Count the sockets in one frame.',
    placement: 'wall',
    ports: ports('power-in'),
    defaultHeight: 0.25,
    countable: true,
  },
  {
    domain: 'power',
    type: 'switch',
    description:
      'Light switch on the wall, usually near a door at about hand height. A double switch has two rockers; a dimmer has a knob or a single large rocker marked as such.',
    placement: 'wall',
    ports: ports('power-in', 'control-out'),
    defaultHeight: 1.05,
    visibleProps: { variant: ['single', 'double', 'dimmer'] },
  },
  {
    domain: 'power',
    type: 'wall_light',
    description: 'Light fitting mounted on a wall (sconce, under-cabinet light counts too).',
    placement: 'wall',
    ports: ports('power-in', 'control-in'),
    defaultHeight: 1.9,
  },
  {
    domain: 'power',
    type: 'ceiling_light',
    description:
      'Light fitting on or hanging from the ceiling, including a bare ceiling outlet (DCL) or hook.',
    placement: 'ceiling',
    ports: ports('power-in', 'control-in'),
  },
];
