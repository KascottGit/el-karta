import type { AiProvider } from '@el-karta/ai-providers';

/** A provider id (as in `createProvidersFromEnv`) and a model id that provider serves. */
export interface ModelChoice {
  provider: string;
  model: string;
}

/** The model a pass runs on, and the one it falls back to when the primary's provider fails. */
export interface PassModels {
  primary: ModelChoice;
  fallback?: ModelChoice;
}

const haiku: ModelChoice = { provider: 'anthropic', model: 'claude-haiku-5-5' };
// On the free tier most Flash models answer 503; `pnpm eval probe` shows which models a key can use.
const geminiFlash: ModelChoice = { provider: 'gemini', model: 'gemini-3-flash-preview' };

/** Default models per pass. Evals record the exact `modelVersion` each run reports. */
export const defaultModels: Readonly<Record<string, PassModels>> = {
  'floorplan-locate': { primary: haiku, fallback: geminiFlash },
  floorplan: { primary: haiku, fallback: geminiFlash },
  photo: { primary: haiku, fallback: geminiFlash },
};

export interface ModelAttempt {
  provider: AiProvider;
  model: string;
}

export type ModelPlan = { ok: true; attempts: ModelAttempt[] } | { ok: false; reason: string };

/**
 * The provider and model to try for one run, in order. A requested choice runs alone and only on a
 * configured provider. Otherwise the pass's primary comes first and its fallback second, each only
 * when its provider is configured. A configured fake provider answers every choice, once.
 */
export function planModels(
  passId: string,
  providers: ReadonlyMap<string, AiProvider>,
  requested?: ModelChoice,
): ModelPlan {
  const fake = providers.get('fake');
  const choices = requested ? [requested] : passChoices(defaultModels[passId]);
  const first = choices[0];
  if (first === undefined) return { ok: false, reason: `No default model for "${passId}"` };
  if (fake) return { ok: true, attempts: [{ provider: fake, model: first.model }] };

  const attempts = choices.flatMap((choice) => {
    const provider = providers.get(choice.provider);
    return provider ? [{ provider, model: choice.model }] : [];
  });
  if (attempts.length > 0) return { ok: true, attempts };
  const wanted = [...new Set(choices.map((choice) => choice.provider))].join(' or ');
  return { ok: false, reason: `No AI provider configured for "${passId}" (needs ${wanted})` };
}

const passChoices = (models: PassModels | undefined): ModelChoice[] =>
  models ? [models.primary, ...(models.fallback ? [models.fallback] : [])] : [];
