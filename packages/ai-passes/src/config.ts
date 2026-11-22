/**
 * Default model per pass. On the free tier most Flash models answer 503 and each model allows 20
 * requests a day; `pnpm eval probe` shows which models a key can use. Evals record the exact
 * `modelVersion` each run reports.
 */
export const defaultModels: Readonly<Record<string, string>> = {
  'floorplan-locate': 'gemini-3-flash-preview',
  floorplan: 'gemini-3-flash-preview',
};
