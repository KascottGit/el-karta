import { z } from 'zod';

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** Plan coordinates in metres: x right, y down (same orientation as plan images). */
export const Pt = z.object({ x: z.number(), y: z.number() });
export type Pt = z.infer<typeof Pt>;

/** Plan x/y plus z in metres above the floor's elevation, or absolute when resolved. */
export const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
export type Vec3 = z.infer<typeof Vec3>;

export const Provenance = z.object({
  status: z.enum(['manual', 'detected', 'suggested', 'confirmed']),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type Provenance = z.infer<typeof Provenance>;
