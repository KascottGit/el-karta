import { createProvidersFromEnv, providerKeys } from '@el-karta/ai-providers';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { floorplanEvalChoice, runFloorplanEval } from './floorplan/run.ts';
import { probe } from './probe.ts';
import { writeSummary } from './summary.ts';

const USAGE = `Usage: pnpm eval floorplan [--provider <id>] [--model <id>] [--estimate-scale] [--plans a,b] [--images <dir>]
       pnpm eval summary   (writes evals/results/floorplan-summary.md from floorplan.csv)
       pnpm eval probe --model <id> --plan <file> [--timeout <s>]   (Gemini: times a tiny request and one locate call)

--provider is ${Object.keys(providerKeys).join(' or ')} (default: the floor-plan pass's primary provider);
--model defaults to the floor-plan pass's model on that provider. Needs the provider's key
(${Object.values(providerKeys).join(', ')}) in the shell or in supabase/functions/.env. Results are appended
to evals/results/floorplan.csv; raw model outputs go to evals/results/raw/ (git-ignored).`;

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
    const summaries = await writeSummary(
      resolve(results, 'floorplan.csv'),
      resolve(results, 'floorplan-summary.md'),
      'evals/results/floorplan.csv',
    );
    say(`${summaries.length} groups written to evals/results/floorplan-summary.md`);
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
  if (values.help || suite !== 'floorplan') {
    say(USAGE);
    return values.help ? 0 : 1;
  }
  const choice = floorplanEvalChoice(values.provider, values.model);
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
  say(`Evaluating ${choice.provider} ${choice.model}`);
  const rows = await runFloorplanEval({
    provider,
    model: choice.model,
    mode: values['estimate-scale'] ? 'estimate' : 'printed',
    plans: values.plans?.split(',').map((id) => id.trim()),
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
