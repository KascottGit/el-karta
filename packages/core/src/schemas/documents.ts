import { z } from 'zod';
import { Connection, Device } from './device.ts';
import { Id, Pt } from './primitives.ts';
import { Grid, Opening, Room, Wall, Zone } from './space.ts';

/** Collections are keyed by item id so Immer patch paths stay valid when others add or remove items. */
const byId = <T extends z.ZodType>(item: T) => z.record(Id, item);

export const Building = z.object({ id: Id, name: z.string() });
export type Building = z.infer<typeof Building>;

export const ProjectData = z.object({
  schemaVersion: z.int().positive(),
  buildings: byId(Building),
  crossFloorConnections: byId(Connection),
});
export type ProjectData = z.infer<typeof ProjectData>;

export const FloorData = z.object({
  schemaVersion: z.int().positive(),
  elevation: z.number(),
  height: z.number().positive(),
  scale: z
    .object({
      source: z.enum(['dimension_text', 'user', 'ai_estimate']),
      metresPerPixel: z.number().positive(),
    })
    .optional(),
  background: z
    .object({
      attachmentId: Id,
      pdfPage: z.int().positive().optional(),
      offset: Pt,
      rotation: z.number(),
    })
    .optional(),
  grid: Grid.optional(),
  walls: byId(Wall),
  openings: byId(Opening),
  rooms: byId(Room),
  zones: byId(Zone),
  devices: byId(Device),
  connections: byId(Connection),
});
export type FloorData = z.infer<typeof FloorData>;

export const ProjectKind = z.enum(['home', 'office', 'warehouse', 'other']);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const ProjectRecord = z.object({
  id: Id,
  name: z.string(),
  kind: ProjectKind,
  version: z.int().positive(),
  data: ProjectData,
});
export type ProjectRecord = z.infer<typeof ProjectRecord>;

export const FloorRecord = z.object({
  id: Id,
  projectId: Id,
  buildingId: Id,
  name: z.string(),
  sortOrder: z.int(),
  version: z.int().positive(),
  data: FloorData,
});
export type FloorRecord = z.infer<typeof FloorRecord>;

/** A loaded project: the project document plus every floor document. */
export const Model = z.object({
  project: ProjectRecord,
  floors: byId(FloorRecord),
});
export type Model = z.infer<typeof Model>;

export type FloorCollection = 'walls' | 'openings' | 'rooms' | 'zones' | 'devices' | 'connections';
