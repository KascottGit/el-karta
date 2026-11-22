import { createGeminiProvider, ProviderError, type GenerateRequest } from '@el-karta/ai-providers';
import { floorplanLocatePass } from '@el-karta/ai-passes';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadPlanImage } from './floorplan/image.ts';

/** One request, timed, with its outcome; never the key or the payload. */
export interface ProbeResult {
  name: string;
  ms: number;
  outcome: string;
}

/**
 * Isolates why a model does not answer: a tiny text request, then the locate pass on one plan image,
 * each with a long timeout so the real latency shows instead of our own cut-off.
 */
export async function probe(options: {
  apiKey: string;
  model: string;
  planPath: string;
  timeoutMs: number;
  /** Only the REST checks (model list, plain and JSON text), not the SDK calls. */
  skipSdk?: boolean;
  log: (line: string) => void;
}): Promise<ProbeResult[]> {
  const provider = createGeminiProvider({ apiKey: options.apiKey, timeoutMs: options.timeoutMs });
  const timed = async (name: string, request: GenerateRequest): Promise<ProbeResult> => {
    const start = Date.now();
    let outcome: string;
    try {
      const response = await provider.generateStructured(request);
      outcome = `ok (${response.modelVersion ?? '?'}, in ${response.usage.inputTokens ?? '?'} / out ${response.usage.outputTokens ?? '?'} tokens): ${response.text.slice(0, 120)}`;
    } catch (error) {
      outcome =
        error instanceof ProviderError
          ? `${error.kind}: ${error.message.slice(0, 300)}`
          : String(error).slice(0, 300);
    }
    const result = { name, ms: Date.now() - start, outcome };
    options.log(`${name}: ${result.ms} ms, ${outcome}`);
    return result;
  };

  const api = 'https://generativelanguage.googleapis.com/v1beta';
  const headers = { 'x-goog-api-key': options.apiKey, 'content-type': 'application/json' };
  const rest = async (name: string, path: string, body?: unknown): Promise<unknown> => {
    const start = Date.now();
    try {
      const res = await fetch(`${api}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(Math.min(options.timeoutMs, 90_000)),
      });
      const json = (await res.json()) as unknown;
      options.log(`${name}: ${Date.now() - start} ms, HTTP ${res.status}`);
      return json;
    } catch (error) {
      options.log(`${name}: ${Date.now() - start} ms, ${String(error).slice(0, 200)}`);
      return null;
    }
  };

  const list = (await rest('list models', 'models?pageSize=1000')) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  } | null;
  const names = (list?.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''));
  options.log(`generateContent models: ${names.join(', ') || '(none)'}`);

  const ask = {
    contents: [{ role: 'user', parts: [{ text: 'Is the sky blue? Answer yes or no.' }] }],
  };
  const plain = await rest('plain text, no schema', `models/${options.model}:generateContent`, ask);
  options.log(`  -> ${JSON.stringify(plain).slice(0, 300)}`);
  const json = await rest('plain text, JSON schema', `models/${options.model}:generateContent`, {
    ...ask,
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(z.object({ ok: z.boolean() }), { io: 'input' }),
    },
  });
  options.log(`  -> ${JSON.stringify(json).slice(0, 300)}`);
  if (options.skipSdk) return [];

  const results = [
    await timed('text', {
      model: options.model,
      system: 'Answer in JSON.',
      messages: [{ role: 'user', text: 'Is the sky blue? Answer {"ok": true} or {"ok": false}.' }],
      images: [],
      jsonSchema: z.toJSONSchema(z.object({ ok: z.boolean() }), { io: 'input' }),
    }),
  ];
  const image = await loadPlanImage(resolve(options.planPath), 1);
  const whole = { x: 0, y: 0, width: image.width, height: image.height };
  const prompt = floorplanLocatePass.prompt({ image: await image.encode(whole) });
  results.push(
    await timed(`locate ${image.width}x${image.height}`, {
      model: options.model,
      system: prompt.system,
      messages: [{ role: 'user', text: prompt.text }],
      images: prompt.images,
      jsonSchema: z.toJSONSchema(floorplanLocatePass.outputSchema, { io: 'input' }),
    }),
  );
  return results;
}
