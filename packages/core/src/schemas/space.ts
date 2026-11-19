import { z } from 'zod';
import { Id, Provenance, Pt } from './primitives.ts';

export const Wall = z.object({
  id: Id,
  a: Pt,
  b: Pt,
  thickness: z.number().positive(),
  height: z.number().positive().optional(),
  provenance: Provenance,
});
export type Wall = z.infer<typeof Wall>;

export const Opening = z.object({
  id: Id,
  wallId: Id,
  kind: z.enum(['door', 'window', 'passage']),
  offset: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  sill: z.number().nonnegative().optional(),
  hinge: z.enum(['left', 'right']).optional(),
  swing: z.enum(['in', 'out']).optional(),
  provenance: Provenance,
});
export type Opening = z.infer<typeof Opening>;

export const RoomType = z.enum([
  'kitchen',
  'bathroom',
  'hallway',
  'bedroom',
  'living_room',
  'laundry',
  'office',
  'warehouse',
  'technical_room',
  'other',
]);
export type RoomType = z.infer<typeof RoomType>;

export const Polygon = z.array(Pt);
export type Polygon = z.infer<typeof Polygon>;

export const Room = z.object({
  id: Id,
  name: z.string(),
  type: RoomType,
  polygon: Polygon,
  ceilingHeight: z.number().positive().optional(),
  provenance: Provenance,
});
export type Room = z.infer<typeof Room>;

export const Zone = z.object({
  id: Id,
  name: z.string(),
  polygon: Polygon,
  provenance: Provenance,
});
export type Zone = z.infer<typeof Zone>;

export const GridLine = z.object({ label: z.string().min(1), pos: z.number() });
export type GridLine = z.infer<typeof GridLine>;

export const Grid = z.object({ xLines: z.array(GridLine), yLines: z.array(GridLine) });
export type Grid = z.infer<typeof Grid>;
