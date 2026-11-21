import {
  ProviderError,
  type GenerateResponse,
  type Message,
  type Usage,
} from '@el-karta/ai-providers';
import type { Issue } from '@el-karta/core';
import { z } from 'zod';
import type { AiPass, RunOptions, RunResult } from './pass.ts';

export interface RunPassOptions extends RunOptions {
  /** Milliseconds clock for `durationMs`; tests inject a fake one. */
  now?: () => number;
}

type Attempt<Out> = { ok: true; output: Out; issues: Issue[] } | { ok: false; problem: string };

/**
 * Runs one pass (ADR 0007): prompt, call, parse, validate, and one retry carrying the parse error
 * or the `error` issues back to the model. Warnings never trigger the retry.
 */
export async function runPass<In, Out, Opts>(
  pass: AiPass<In, Out, Opts>,
  rawInput: unknown,
  options: RunPassOptions,
): Promise<RunResult<Out>> {
  const now = options.now ?? Date.now;
  const start = now();
  const usage: Usage = {};
  let images = 0;
  let validationRetries = 0;
  let modelVersion: string | undefined;

  const finish = (
    fields: Pick<RunResult<Out>, 'status' | 'output' | 'issues'> & { error?: string },
  ): RunResult<Out> => ({
    ...fields,
    validationRetries,
    usage,
    images,
    model: options.model,
    ...(modelVersion !== undefined ? { modelVersion } : {}),
    durationMs: now() - start,
  });

  const parsedInput = pass.inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return finish({
      status: 'error',
      output: null,
      issues: [],
      error: `Invalid input: ${z.prettifyError(parsedInput.error)}`,
    });
  }
  const input = parsedInput.data;

  try {
    const prompt = pass.prompt(input);
    images = prompt.images.length;
    // The model writes what the schema parses, so defaults and transforms are not yet applied.
    const jsonSchema = z.toJSONSchema(pass.outputSchema, { io: 'input' }) as Record<
      string,
      unknown
    >;
    const messages: Message[] = [{ role: 'user', text: prompt.text }];

    const call = async () => {
      const response = await options.provider.generateStructured({
        model: options.model,
        system: prompt.system,
        messages,
        images: prompt.images,
        jsonSchema,
      });
      addUsage(usage, response.usage);
      if (response.modelVersion !== undefined) modelVersion = response.modelVersion;
      return response;
    };

    let response = await call();
    let attempt = check(pass, input, response);
    if (needsRetry(attempt)) {
      validationRetries = 1;
      messages.push(
        { role: 'model', text: response.text },
        { role: 'user', text: feedback(attempt) },
      );
      const first = attempt;
      response = await call();
      attempt = check(pass, input, response);
      if (!attempt.ok && first.ok) {
        return finish({
          status: 'invalid',
          output: first.output,
          issues: first.issues,
          error: attempt.problem,
        });
      }
    }

    if (!attempt.ok) {
      return finish({ status: 'invalid', output: null, issues: [], error: attempt.problem });
    }
    return finish({
      status: needsRetry(attempt) ? 'invalid' : 'ok',
      output: attempt.output,
      issues: attempt.issues,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof ProviderError && error.kind === 'rate_limited' ? 'rate_limited' : 'error';
    return finish({ status, output: null, issues: [], error: message });
  }
}

function check<In, Out, Opts>(
  pass: AiPass<In, Out, Opts>,
  input: In,
  response: GenerateResponse,
): Attempt<Out> {
  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch (error) {
    return { ok: false, problem: `The answer was not valid JSON: ${String(error)}` };
  }
  const parsed = pass.outputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problem: `The answer did not match the JSON Schema:\n${z.prettifyError(parsed.error)}`,
    };
  }
  return { ok: true, output: parsed.data, issues: pass.validate(parsed.data, input) };
}

function needsRetry(attempt: Attempt<unknown>): boolean {
  return !attempt.ok || attempt.issues.some((issue) => issue.severity === 'error');
}

function feedback(attempt: Attempt<unknown>): string {
  if (!attempt.ok) return `${attempt.problem}\nAnswer again with corrected JSON only.`;
  const lines = attempt.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => {
      const ids = issue.ids.length > 0 ? ` ids=${issue.ids.join(',')}` : '';
      const params = issue.params ? ` params=${JSON.stringify(issue.params)}` : '';
      return `- ${issue.code}${ids}${params}`;
    });
  return `The answer failed these checks:\n${lines.join('\n')}\nFix them and answer again with the full corrected JSON.`;
}

function addUsage(total: Usage, part: Usage): void {
  if (part.inputTokens !== undefined) {
    total.inputTokens = (total.inputTokens ?? 0) + part.inputTokens;
  }
  if (part.outputTokens !== undefined) {
    total.outputTokens = (total.outputTokens ?? 0) + part.outputTokens;
  }
}
