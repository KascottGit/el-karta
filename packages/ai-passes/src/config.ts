/**
 * Default model per pass. Google's `-latest` aliases move with new releases, so evals record the
 * exact `modelVersion` each run reports.
 */
export const defaultModels: Readonly<Record<string, string>> = {
  'floorplan-locate': 'gemini-flash-latest',
  floorplan: 'gemini-flash-latest',
};
