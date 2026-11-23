import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type CsvValue = string | number | boolean | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'number' ? String(Math.round(value * 10_000) / 10_000) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (values: readonly CsvValue[]) => `${values.map(cell).join(',')}\n`;

/** RFC 4180 rows as written by `csvLine`: quoted cells may hold commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (value !== '' || row.length > 0) rows.push([...row, value]);
  return rows;
}

/** Each row after the header as a record by column name; cells a short row lacks are `''`. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header = [], ...rows] = parseCsv(text);
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ''])));
}

const readIfExists = (path: string) =>
  readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });

/**
 * Appends `rows` to the CSV at `path` in the order of `columns`, writing the header first when the
 * file is new. A file whose columns are all among `columns` is rewritten once in the new order,
 * with empty cells in the added columns. Any other header is refused, so columns never shift under
 * old rows.
 */
export async function appendCsv<C extends string>(
  path: string,
  columns: readonly C[],
  rows: readonly Readonly<Partial<Record<C, CsvValue>>>[],
): Promise<void> {
  const header = csvLine(columns);
  const body = rows.map((row) => csvLine(columns.map((c) => row[c]))).join('');
  const existing = await readIfExists(path);
  if (existing === null) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, header + body);
  } else if (existing.startsWith(header)) {
    await appendFile(path, body);
  } else {
    const old = parseCsv(existing)[0] ?? [];
    if (!old.every((name) => (columns as readonly string[]).includes(name)))
      throw new Error(`${path} has other columns; move it aside to start a new file`);
    const kept = csvRecords(existing)
      .map((record) => csvLine(columns.map((c) => record[c])))
      .join('');
    await writeFile(path, header + kept + body);
  }
}
