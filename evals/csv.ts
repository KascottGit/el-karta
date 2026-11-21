import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type CsvValue = string | number | boolean | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'number' ? String(Math.round(value * 10_000) / 10_000) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (values: readonly CsvValue[]) => `${values.map(cell).join(',')}\n`;

/**
 * Appends `rows` to the CSV at `path` in the order of `columns`, writing the header first when the
 * file is new. Refuses a file whose header differs, so columns never shift under old rows.
 */
export async function appendCsv<C extends string>(
  path: string,
  columns: readonly C[],
  rows: readonly Readonly<Partial<Record<C, CsvValue>>>[],
): Promise<void> {
  const header = csvLine(columns);
  const existing = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null && !existing.startsWith(header))
    throw new Error(`${path} has other columns; move it aside to start a new file`);
  await mkdir(dirname(path), { recursive: true });
  const body = rows.map((row) => csvLine(columns.map((c) => row[c]))).join('');
  await appendFile(path, existing === null ? header + body : body);
}
