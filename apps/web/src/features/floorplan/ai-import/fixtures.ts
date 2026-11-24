import { defaultModels, type PlanImage } from '@el-karta/ai-passes';
import {
  createEmptyProject,
  type FloorRecord,
  type Id,
  type Suggestion,
  type SuggestionStatus,
} from '@el-karta/core';
import type { AiCommitRequest, AiRunRequest } from '@el-karta/data-supabase';
import { QueryClient } from '@tanstack/react-query';
import type { SuggestionSource } from '@/features/suggestions/source';
import type { AiPassBackend } from '@/lib/ai-pass';
import replyText from '../../../../e2e/fixtures/ai-plan-reply.json?raw';
import { createMemoryJson } from '../background/project-json';
import type { ImportDeps } from './flow';

/**
 * The fake provider's reply in the e2e test: the two-room flat of `e2e/fixtures/plan.png` (800 × 600
 * px, 8 mm per pixel), with no printed scale but a door leaf and a wardrobe to estimate one from.
 */
export const planReply = (): unknown => JSON.parse(replyText);

export const PLAN_SIZE = { width: 800, height: 600 };
export const TRUE_METRES_PER_PIXEL = 0.008;

/** A floor with a background at the plan origin, unturned and without a scale. */
export function floorWithBackground(): FloorRecord {
  const model = createEmptyProject({
    id: () => crypto.randomUUID(),
    name: 'Test',
    kind: 'home',
    buildingName: 'Hus',
    floorName: 'Plan 1',
  });
  const floor = Object.values(model.floors)[0]!;
  return {
    ...floor,
    data: {
      ...floor.data,
      background: { attachmentId: crypto.randomUUID(), offset: { x: 0, y: 0 }, rotation: 0 },
    },
  };
}

/** An image that "encodes" a region as its JSON, so tests see what each call was sent. */
export const fakeImage = (pdfPageWidthMm?: number): PlanImage => ({
  ...PLAN_SIZE,
  pdfPageWidthMm,
  encode: (region) => Promise.resolve({ mimeType: 'image/png', data: JSON.stringify(region) }),
});

type RunReply = (request: Omit<AiRunRequest, 'action'>) => Promise<unknown>;

/** The provider and model a run answers with when the primary is up: the pass's primary. */
export const answeredBy = (pass: string) => defaultModels[pass]!.primary;

/**
 * The `ai-pass` function in memory: `run` answers with `reply` (the plan reply by default) and
 * `commit` stores pending rows that `source` lists, as the real function and table do.
 */
export function fakeBackend(reply: RunReply = () => Promise.resolve(planReply())) {
  const runs: Omit<AiRunRequest, 'action'>[] = [];
  const commits: Omit<AiCommitRequest, 'action'>[] = [];
  const rows = new Map<Id, Suggestion>();
  const backend: AiPassBackend = {
    run: async (request) => {
      runs.push(request);
      const output = await reply(request);
      return {
        runId: crypto.randomUUID(),
        ...answeredBy(request.pass),
        status: 'ok',
        output,
        issues: [],
      };
    },
    commit: (request) => {
      commits.push(request);
      for (const draft of request.suggestions)
        rows.set(draft.id, {
          ...draft,
          projectId: request.projectId,
          floorId: request.floorId,
          runId: request.runIds.length === 1 ? request.runIds[0]! : null,
          pass: request.pass,
          source: request.source,
          status: 'pending',
        });
      return Promise.resolve({ ids: request.suggestions.map((d) => d.id) });
    },
  };
  const source: SuggestionSource = {
    id: 'fake',
    list: (floorId) => Promise.resolve([...rows.values()].filter((s) => s.floorId === floorId)),
    setStatus: (ids, status) => {
      for (const id of ids) rows.set(id, { ...rows.get(id)!, status });
      return Promise.resolve();
    },
  };
  const files = createMemoryJson();
  const deps: ImportDeps = {
    backend,
    files,
    source,
    queries: new QueryClient(),
    newId: () => crypto.randomUUID(),
  };
  const withStatus = (status: SuggestionStatus) =>
    [...rows.values()].filter((s) => s.status === status);
  return { deps, runs, commits, rows, files, withStatus };
}
