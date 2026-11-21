/**
 * Default model per pass. Google retires model names for new users, so pick from what the key's
 * error messages and AI Studio list; evals record the exact `modelVersion` each run reports.
 */
export const defaultModels: Readonly<Record<string, string>> = {
  'floorplan-locate': 'gemini-3.8-flash',
  floorplan: 'gemini-3.8-flash',
};
