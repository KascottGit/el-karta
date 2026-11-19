import { z } from 'zod';
import { Id, Provenance, Pt, Vec3 } from './primitives.ts';

export const WallPlacement = z.object({
  kind: z.literal('wall'),
  wallId: Id,
  offset: z.number().nonnegative(),
  height: z.number(),
  side: z.enum(['left', 'right']),
});

export const CeilingPlacement = z.object({
  kind: z.literal('ceiling'),
  roomId: Id,
  at: Pt,
});

export const FloorPlacement = z.object({
  kind: z.literal('floor'),
  at: Pt,
  rotation: z.number().optional(),
  size: Vec3.optional(),
});

export const ContainerPlacement = z.object({
  kind: z.literal('container'),
  parentId: Id,
  slot: z.int().nonnegative(),
});

export const Placement = z.discriminatedUnion('kind', [
  WallPlacement,
  CeilingPlacement,
  FloorPlacement,
  ContainerPlacement,
]);
export type Placement = z.infer<typeof Placement>;
export type PlacementKind = Placement['kind'];

export const Port = z.object({
  id: Id,
  domain: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().optional(),
});
export type Port = z.infer<typeof Port>;

export const Device = z.object({
  id: Id,
  domain: z.string().min(1),
  type: z.string().min(1),
  label: z.string(),
  roomId: Id.optional(),
  zoneId: Id.optional(),
  placement: Placement,
  count: z.int().positive().optional(),
  props: z.record(z.string(), z.unknown()),
  ports: z.array(Port),
  provenance: Provenance,
  attachmentIds: z.array(Id).optional(),
});
export type Device = z.infer<typeof Device>;

export const RouteCertainty = z.enum(['verified', 'traced', 'inferred', 'unknown']);
export type RouteCertainty = z.infer<typeof RouteCertainty>;

export const RouteSegment = z.object({
  floorId: Id,
  points: z.array(Vec3),
  certainty: RouteCertainty,
});
export type RouteSegment = z.infer<typeof RouteSegment>;

export const Connection = z.object({
  id: Id,
  domain: z.string().min(1),
  kind: z.string().min(1),
  fromPortId: Id,
  toPortId: Id,
  provenance: Provenance,
  route: z.array(RouteSegment).optional(),
  attachmentIds: z.array(Id).optional(),
});
export type Connection = z.infer<typeof Connection>;
