import { floorplanLocatePass, floorplanPass } from './floorplan/passes.ts';
import type { AnyAiPass } from './pass.ts';
import { photoPass } from './photo/passes.ts';

/** Every pass the `ai-pass` Edge Function can run; a new pass is added here (ADR 0007). */
export const allPasses: readonly AnyAiPass[] = [floorplanLocatePass, floorplanPass, photoPass];
