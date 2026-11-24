import { costUsd, modelPrice, type ModelPrice } from '@el-karta/ai-providers';
import { readFile, writeFile } from 'node:fs/promises';
import { csvRecords } from './csv.ts';
import type { FloorplanScores } from './floorplan/score.ts';
import { countAccuracy, parseCounts, type PhotoScores } from './photo/score.ts';

/** One results CSV row by column name, as read; empty cells are `''`. */
export type ResultRow = Readonly<Record<string, string>>;

/** Rows from before the `provider` column were all Gemini runs. */
export const LEGACY_PROVIDER = 'gemini';

const number = (cell: string | undefined): number | undefined =>
  cell === undefined || cell === '' ? undefined : Number(cell);

export const rowProvider = (row: ResultRow) => row['provider'] || LEGACY_PROVIDER;

/** The row's `costUsd`, or else its cost from the token totals and the price table. */
export function rowCost(row: ResultRow): number | undefined {
  const recorded = number(row['costUsd']);
  if (recorded !== undefined) return recorded;
  const inputTokens = number(row['inputTokens']);
  const outputTokens = number(row['outputTokens']);
  return costUsd(
    rowProvider(row),
    row['model'] ?? '',
    {
      ...(inputTokens !== undefined && { inputTokens }),
      ...(outputTokens !== undefined && { outputTokens }),
    },
    number(row['calls']) ?? 1,
  );
}

export interface RowGroup {
  provider: string;
  model: string;
  mode: string;
  rows: ResultRow[];
}

/** Rows by provider, model and mode, sorted by those three. */
export function groupRows(rows: readonly ResultRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  for (const row of rows) {
    const provider = rowProvider(row);
    const model = row['model'] ?? '';
    const mode = row['mode'] ?? '';
    const key = JSON.stringify([provider, model, mode]);
    const group = groups.get(key) ?? { provider, model, mode, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const order = (g: RowGroup) => [g.provider, g.model, g.mode].join('\u0000');
  return [...groups.values()].sort((a, b) => (order(a) < order(b) ? -1 : 1));
}

export const mean = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : values.reduce((sum, v) => sum + v, 0) / values.length;

/** The `p`-th percentile (0–100), linearly interpolated between the closest ranks. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

/** Share of rows whose `status` is not `ok`. */
export const failureRate = (rows: readonly ResultRow[]): number | undefined =>
  rows.length === 0 ? undefined : rows.filter((r) => r['status'] !== 'ok').length / rows.length;

type Aggregate = 'mean' | 'meanAbs' | 'shareTrue';

/** What differs between the passes' summaries. */
export interface SummarySpec {
  title: string;
  /** The README that defines the columns. */
  readme: string;
  /** The column naming what one row evaluated, and how it reads in the table. */
  item: { column: string; plural: string; singular: string };
  /** How each score column is summarised; signed errors as a mean absolute so they cannot cancel. */
  scores: Readonly<Record<string, Aggregate>>;
  /** Further figures per group, by label; the table shows the union of the groups' labels. */
  extra?: (rows: readonly ResultRow[]) => Record<string, number | undefined>;
  /** Appended to the paragraph under the table. */
  note?: string;
}

const FLOORPLAN_AGGREGATES: Record<keyof FloorplanScores, Aggregate> = {
  roomsExpected: 'mean',
  roomsFound: 'mean',
  nameMatch: 'mean',
  typeAccuracy: 'mean',
  doorsExpected: 'mean',
  doorsFound: 'mean',
  scaleError: 'meanAbs',
  estimateWithin10: 'shareTrue',
  rotationErrorDeg: 'mean',
  roomAreaError: 'mean',
  wallLengthError: 'meanAbs',
};

export const floorplanSummary: SummarySpec = {
  title: 'Floor-plan eval summary',
  readme: 'evals/floorplan/README.md',
  item: { column: 'plan', plural: 'Plans', singular: 'plan' },
  scores: FLOORPLAN_AGGREGATES,
  note: ' Rows without a `provider` are Gemini runs from before the column existed.',
};

type PhotoScoreColumn = Exclude<keyof PhotoScores, 'countsByType'>;

const PHOTO_AGGREGATES: Record<PhotoScoreColumn, Aggregate> = {
  expected: 'mean',
  found: 'mean',
  matched: 'mean',
  precision: 'mean',
  recall: 'mean',
  typeAccuracy: 'mean',
  wallAccuracy: 'mean',
  countAccuracy: 'mean',
  unitCountAccuracy: 'mean',
  propsAccuracy: 'mean',
  meanOffsetError: 'mean',
  meanHeightError: 'mean',
  roughShare: 'mean',
  corrections: 'mean',
};

/**
 * `countAccuracy` per device type, pooled over the rows: 1 − Σ|found − expected| / Σ max(found,
 * expected) of that type's counts in `countsByType`.
 */
export function countAccuracyByType(rows: readonly ResultRow[]): Record<string, number> {
  const pooled = new Map<string, { found: number; expected: number }[]>();
  for (const row of rows)
    for (const [type, counts] of parseCounts(row['countsByType'] ?? ''))
      pooled.set(type, [...(pooled.get(type) ?? []), counts]);
  return Object.fromEntries(
    [...pooled]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([type, counts]) => [`countAccuracy ${type} (pooled)`, countAccuracy(counts)]),
  );
}

export const photoSummary: SummarySpec = {
  title: 'Photo eval summary',
  readme: 'evals/photo/README.md',
  item: { column: 'photo', plural: 'Photos', singular: 'photo' },
  scores: PHOTO_AGGREGATES,
  extra: countAccuracyByType,
};

/** Rows that have a value in `column` count; empty cells are left out. */
function aggregate(rows: readonly ResultRow[], column: string, how: Aggregate): number | undefined {
  const cells = rows.map((r) => r[column] ?? '').filter((cell) => cell !== '');
  if (how === 'shareTrue') return mean(cells.map((cell) => (cell === 'true' ? 1 : 0)));
  const values = cells.map(Number);
  return mean(how === 'meanAbs' ? values.map(Math.abs) : values);
}

export interface GroupSummary {
  provider: string;
  model: string;
  mode: string;
  runs: number;
  /** Distinct plans or photos. */
  items: number;
  scores: Record<string, number | undefined>;
  extra: Record<string, number | undefined>;
  meanCostUsd: number | undefined;
  medianDurationMs: number | undefined;
  p90DurationMs: number | undefined;
  failureRate: number | undefined;
}

export function summarizeGroup(
  { provider, model, mode, rows }: RowGroup,
  spec: SummarySpec,
): GroupSummary {
  const durations = rows.map((r) => number(r['durationMs'])).filter((d) => d !== undefined);
  const costs = rows.map(rowCost).filter((c) => c !== undefined);
  const scores = Object.fromEntries(
    Object.entries(spec.scores).map(([column, how]) => [column, aggregate(rows, column, how)]),
  );
  return {
    provider,
    model,
    mode,
    runs: rows.length,
    items: new Set(rows.map((r) => r[spec.item.column])).size,
    scores,
    extra: spec.extra?.(rows) ?? {},
    meanCostUsd: mean(costs),
    medianDurationMs: percentile(durations, 50),
    p90DurationMs: percentile(durations, 90),
    failureRate: failureRate(rows),
  };
}

const fixed = (digits: number) => (value: number | undefined) =>
  value === undefined ? '–' : value.toFixed(digits);
const seconds = (ms: number | undefined) => (ms === undefined ? '–' : (ms / 1000).toFixed(1));
const percent = (share: number | undefined) =>
  share === undefined ? '–' : `${(share * 100).toFixed(0)} %`;
const dollars = (usd: number | undefined) => (usd === undefined ? '–' : `$${usd.toFixed(4)}`);

const SCORE_LABELS: Record<Aggregate, (column: string) => string> = {
  mean: (column) => `${column} (mean)`,
  meanAbs: (column) => `${column} (mean absolute)`,
  shareTrue: (column) => `${column} (share true)`,
};

/**
 * A table with the first column left-aligned and the rest right-aligned, padded the way Prettier
 * pads it, so the generated file passes `pnpm lint`.
 */
function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, i) =>
    Math.max(3, cell.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const pad = (cell: string, i: number) =>
    i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!);
  const line = (cells: readonly string[]) => `| ${cells.map(pad).join(' | ')} |`;
  const rule = widths.map((w, i) => (i === 0 ? '-'.repeat(w) : `${'-'.repeat(w - 1)}:`));
  return [line(header), `| ${rule.join(' | ')} |`, ...rows.map(line)];
}

/** The summary as Markdown: one column per provider, model and mode, one row per figure. */
export function summaryMarkdown(
  summaries: readonly GroupSummary[],
  source: string,
  spec: SummarySpec,
): string {
  const extra = [...new Set(summaries.flatMap((s) => Object.keys(s.extra)))].sort();
  const figures: [string, (s: GroupSummary) => string][] = [
    ['Runs (rows)', (s) => String(s.runs)],
    [spec.item.plural, (s) => String(s.items)],
    ...Object.entries(spec.scores).map(([column, how]): [string, (s: GroupSummary) => string] => [
      SCORE_LABELS[how](column),
      (s) => fixed(3)(s.scores[column]),
    ]),
    ...extra.map((label): [string, (s: GroupSummary) => string] => [
      label,
      (s) => fixed(3)(s.extra[label]),
    ]),
    [`Mean cost per ${spec.item.singular} (USD)`, (s) => dollars(s.meanCostUsd)],
    ['Median duration (s)', (s) => seconds(s.medianDurationMs)],
    ['p90 duration (s)', (s) => seconds(s.p90DurationMs)],
    ['Failure rate', (s) => percent(s.failureRate)],
  ];
  const table = markdownTable(
    ['', ...summaries.map((s) => `${s.provider} · ${s.model} · ${s.mode}`)],
    figures.map(([label, value]) => [label, ...summaries.map(value)]),
  );
  const prices = summaries
    .map((s) => modelPrice(s.provider, s.model))
    .filter((p, i, all): p is ModelPrice => p !== undefined && all.indexOf(p) === i)
    .map((p) => {
      const tiers = p.tiers
        .map(
          (t) =>
            `$${t.input} in / $${t.output} out` +
            (t.maxInputTokens === undefined ? '' : ` up to ${t.maxInputTokens} input tokens`),
        )
        .join(', then ');
      return `- ${p.provider} ${p.model}: ${tiers} per 1M tokens (checked ${p.checked}, ${p.source})`;
    });
  return [
    `# ${spec.title}`,
    '',
    `Generated by \`pnpm eval summary\` from \`${source}\`; do not edit by hand. See \`${spec.readme}\` for the columns.`,
    '',
    ...table,
    '',
    `Means are over the rows that have a value. A run is one ${spec.item.singular} in one eval run; failed runs count in the cost, duration and failure rate. Cost is the row’s \`costUsd\`, or else computed from its token totals with the prices below; a model without a price shows –.${spec.note ?? ''}`,
    '',
    '## Prices',
    '',
    ...(prices.length > 0 ? prices : ['None of these models has a price in the table.']),
    '',
  ].join('\n');
}

/** Reads the results CSV and writes its summary. */
export async function writeSummary(
  csvPath: string,
  outPath: string,
  source: string,
  spec: SummarySpec,
) {
  const rows = csvRecords(await readFile(csvPath, 'utf8'));
  const summaries = groupRows(rows).map((group) => summarizeGroup(group, spec));
  await writeFile(outPath, summaryMarkdown(summaries, source, spec));
  return summaries;
}
