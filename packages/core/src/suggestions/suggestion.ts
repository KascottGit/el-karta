import { z } from 'zod';
import { Id } from '../schemas/primitives.ts';

export const SuggestionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

/** An `Issue` as stored with a suggestion; `ids` are model ids inside the suggestion payloads. */
export const SuggestionIssue = z.object({
  code: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type SuggestionIssue = z.infer<typeof SuggestionIssue>;

/**
 * One item an AI pass or rule proposes. It is never part of the model until a person accepts it.
 * `payload` is validated by the kind's schema (see `kinds.ts`); `requires` lists suggestions that
 * must be accepted with this one (an opening requires its suggested wall).
 */
export const Suggestion = z.object({
  id: Id,
  projectId: Id,
  floorId: Id,
  runId: Id.nullable(),
  pass: z.string().min(1),
  kind: z.string().min(1),
  /** Provenance source the accepted item gets, e.g. `ai:floorplan:gemini-2.5-flash`. */
  source: z.string().min(1),
  payload: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  issues: z.array(SuggestionIssue),
  requires: z.array(Id),
  status: SuggestionStatus,
});
export type Suggestion = z.infer<typeof Suggestion>;
