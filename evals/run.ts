import { createProvidersFromEnv, providerKeys } from '@el-karta/ai-providers';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { floorplanEvalChoice, runFloorplanEval } from './floorplan/run.ts';
import { photoEvalChoice, runPhotoEval } from './photo/run.ts';
import { probe } from './probe.ts';
import { floorplanSummary, photoSummary, writeSummary } from './summary.ts';

const USAGE = `Usage: pnpm eval floorplan [--provider <id>] [--model <id>] [--estimate-scale] [--plans a,b] [--images <dir>]
       pnpm eval photo [--provider <id>] [--model <id>] [--earlier] [--photos a,b] [--images <dir>]
       pnpm eval summary   (writes evals/results/<pass>-summary.md from <pass>.csv for floorplan and photo)
       pnpm eval probe --model <id> --plan <file> [--timeout <s>]   (Gemini: times a tiny request and one locate call)

--provider is ${Object.keys(providerKeys).join(' or ')} (default: the pass's primary provider);
--model defaults to the pass's model on that provider. Needs the provider's key
(${Object.values(providerKeys).join(', ')}) in the shell or in supabase/functions/.env. Results are appended
to evals/results/<pass>.csv; raw model outputs go to evals/results/raw/ (git-ignored).`;

const SUMMARIES = [
  { pass: 'floorplan', spec: floorplanSummary },
  { pass: 'photo', spec: photoSummary },
] as const;

/** Where the person keeps the provider keys for the local Edge Function (git-ignored). */
const FUNCTIONS_ENV = resolve(import.meta.dirname, '../supabase/functions/.env');

/**
 * Each provider key from the shell, or from `FUNCTIONS_ENV` when the shell has none. Only the
 * keys are taken, so settings such as `AI_PROVIDER` (in the file or the shell) do not apply here.
 */
function providerEnv(): Record<string, string | undefined> {
  const file = existsSync(FUNCTIONS_ENV) ? parseEnv(readFileSync(FUNCTIONS_ENV, 'utf8')) : {};
  return Object.fromEntries(
    Object.values(providerKeys).map((name) => [name, process.env[name] || file[name]]),
  );
}

const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      provider: { type: 'string' },
      model: { type: 'string' },
      'estimate-scale': { type: 'boolean', default: false },
      plans: { type: 'string' },
      photos: { type: 'string' },
      earlier: { type: 'boolean', default: false },
      images: { type: 'string' },
      plan: { type: 'string' },
      timeout: { type: 'string', default: '300' },
      'rest-only': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const [suite] = positionals;
  if (suite === 'summary') {
    const results = resolve(import.meta.dirname, 'results');
    for (const { pass, spec } of SUMMARIES) {
      const csv = resolve(results, `${pass}.csv`);
      if (!existsSync(csv)) {
        say(`No evals/results/${pass}.csv yet`);
        continue;
      }
      const out = `evals/results/${pass}-summary.md`;
      const summaries = await writeSummary(
        csv,
        resolve(results, `${pass}-summary.md`),
        `evals/results/${pass}.csv`,
        spec,
      );
      say(`${summaries.length} groups written to ${out}`);
    }
    return 0;
  }
  if (suite === 'probe' && values.model && values.plan) {
    const apiKey = providerEnv()[providerKeys.gemini];
    if (!apiKey) throw new Error('No GEMINI_API_KEY in the shell or supabase/functions/.env');
    await probe({
      apiKey,
      model: values.model,
      planPath: values.plan,
      timeoutMs: Number(values.timeout) * 1000,
      skipSdk: values['rest-only'],
      log: say,
    });
    return 0;
  }
  if (values.help || (suite !== 'floorplan' && suite !== 'photo')) {
    say(USAGE);
    return values.help ? 0 : 1;
  }
  const choice = (suite === 'photo' ? photoEvalChoice : floorplanEvalChoice)(
    values.provider,
    values.model,
  );
  // The provider reads the key itself; it is never printed or written to the results.
  const provider = createProvidersFromEnv(providerEnv()).get(choice.provider);
  if (!provider) {
    const key = (providerKeys as Record<string, string | undefined>)[choice.provider];
    throw new Error(
      key
        ? `No ${key} in the shell or supabase/functions/.env`
        : `Unknown provider ${choice.provider}`,
    );
  }
  say(`Evaluating ${suite} on ${choice.provider} ${choice.model}`);
  const list = (text: string | undefined) => text?.split(',').map((id) => id.trim());
  if (suite === 'photo') {
    const rows = await runPhotoEval({
      provider,
      model: choice.model,
      photos: list(values.photos),
      earlier: values.earlier,
      imagesDir: values.images,
      log: say,
    });
    say(`${rows.length} rows appended to evals/results/photo.csv`);
    return 0;
  }
  const rows = await runFloorplanEval({
    provider,
    model: choice.model,
    mode: values['estimate-scale'] ? 'estimate' : 'printed',
    plans: list(values.plans),
    imagesDir: values.images,
    log: say,
  });
  say(`${rows.length} rows appended to evals/results/floorplan.csv`);
  return 0;
}

// pnpm runs this from evals/, and `--` separators reach us as plain arguments.
main(process.argv.slice(2).filter((arg) => arg !== '--')).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
