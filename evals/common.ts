import { defaultModels, type ModelChoice } from '@el-karta/ai-passes';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The provider and model to evaluate a pass on: as given, else the pass's default on it. */
export function passChoice(
  passId: string,
  provider: string | undefined,
  model: string | undefined,
): ModelChoice {
  const { primary, fallback } = defaultModels[passId]!;
  const id = provider ?? primary.provider;
  const chosen = model ?? [primary, fallback].find((choice) => choice?.provider === id)?.model;
  if (chosen === undefined) throw new Error(`No default ${passId} model on ${id}; pass --model`);
  return { provider: id, model: chosen };
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

const fileSafe = (text: string) => text.replace(/[^a-zA-Z0-9.-]+/g, '_');

/**
 * Refuses to run unless every file exists and matches its checksum, so no model call is made on a
 * missing or changed image.
 */
export async function checkFiles(
  files: readonly { name: string; path: string; sha256: string }[],
): Promise<void> {
  const problems: string[] = [];
  await Promise.all(
    files.map(async ({ name, path, sha256: expected }) => {
      const data = await readFile(path).catch(() => null);
      if (data === null) problems.push(`${name}: ${path} is missing`);
      else if (sha256(data) !== expected)
        problems.push(`${name}: ${path} does not match its sha256 in the manifest`);
    }),
  );
  if (problems.length > 0) throw new Error(`Refusing to run:\n${problems.sort().join('\n')}`);
}

/** Writes one run's raw output to `<resultsDir>/raw/<date>-<parts>.json` (git-ignored). */
export async function writeRaw(
  resultsDir: string,
  date: Date,
  parts: readonly string[],
  content: unknown,
): Promise<void> {
  const rawDir = join(resultsDir, 'raw');
  await mkdir(rawDir, { recursive: true });
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  await writeFile(
    join(rawDir, `${[stamp, ...parts.map(fileSafe)].join('-')}.json`),
    JSON.stringify(content, null, 2),
  );
}
