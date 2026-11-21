import { createProviderFromEnv } from '@el-karta/ai-providers';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runFloorplanEval } from './floorplan/run.ts';

const USAGE = `Usage: pnpm eval floorplan --model <id> [--estimate-scale] [--plans a,b] [--images <dir>]

Needs GEMINI_API_KEY in the shell or in supabase/functions/.env. Results are appended to
evals/results/floorplan.csv; raw model outputs go to evals/results/raw/ (git-ignored).`;

/** Where the person keeps the Gemini key for the local Edge Function (git-ignored). */
const FUNCTIONS_ENV = resolve(import.meta.dirname, '../supabase/functions/.env');

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
  if (!process.env['GEMINI_API_KEY'] && existsSync(FUNCTIONS_ENV))
    process.loadEnvFile(FUNCTIONS_ENV);
  const provider = createProviderFromEnv(process.env);
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
