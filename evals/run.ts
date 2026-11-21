import { createProviderFromEnv } from '@el-karta/ai-providers';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { runFloorplanEval } from './floorplan/run.ts';

const USAGE = `Usage: pnpm eval floorplan --model <id> [--estimate-scale] [--plans a,b] [--images <dir>]

Needs GEMINI_API_KEY in the shell or in supabase/functions/.env. Results are appended to
evals/results/floorplan.csv; raw model outputs go to evals/results/raw/ (git-ignored).`;

/** Where the person keeps the Gemini key for the local Edge Function (git-ignored). */
const FUNCTIONS_ENV = resolve(import.meta.dirname, '../supabase/functions/.env');

/**
 * The shell's environment, plus `GEMINI_API_KEY` from `FUNCTIONS_ENV` when the shell has none.
 * Only that key is taken, so the local function's other settings (such as `AI_PROVIDER`) stay out.
 */
function providerEnv(): Record<string, string | undefined> {
  if (process.env['GEMINI_API_KEY'] || !existsSync(FUNCTIONS_ENV)) return process.env;
  const key = parseEnv(readFileSync(FUNCTIONS_ENV, 'utf8'))['GEMINI_API_KEY'];
  return key ? { ...process.env, GEMINI_API_KEY: key } : process.env;
}

const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      'estimate-scale': { type: 'boolean', default: false },
      plans: { type: 'string' },
      images: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const [suite] = positionals;
  if (values.help || suite !== 'floorplan' || !values.model) {
    say(USAGE);
    return values.help ? 0 : 1;
  }
  // The provider reads the key itself; it is never printed or written to the results.
  const provider = createProviderFromEnv(providerEnv());
  const rows = await runFloorplanEval({
    provider,
    model: values.model,
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
