import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvLine, type CsvValue } from '../csv.ts';
import { FLOORPLAN_COLUMNS } from '../floorplan/run.ts';
import {
  failureRate,
  groupRows,
  mean,
  percentile,
  rowCost,
  rowProvider,
  summarizeGroup,
  summaryMarkdown,
  writeSummary,
  type ResultRow,
} from '../summary.ts';

const row = (fields: Record<string, string>): ResultRow => ({
  plan: 'p1',
  model: 'gemini-3-flash-preview',
  mode: 'printed',
  status: 'ok',
  ...fields,
});

describe('percentile', () => {
  it('interpolates between the closest ranks', () => {
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBeCloseTo(91, 9);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe('mean and failureRate', () => {
  it('handle empty input and count every status other than ok as a failure', () => {
    expect(mean([])).toBeUndefined();
    expect(mean([1, 2, 6])).toBe(3);
    expect(failureRate([])).toBeUndefined();
    const rows = ['ok', 'error', 'invalid', 'ok'].map((status) => row({ status }));
    expect(failureRate(rows)).toBe(0.5);
  });
});

describe('rowProvider and rowCost', () => {
  it('reads a row without a provider as Gemini', () => {
    expect(rowProvider(row({}))).toBe('gemini');
    expect(rowProvider(row({ provider: '' }))).toBe('gemini');
    expect(rowProvider(row({ provider: 'anthropic' }))).toBe('anthropic');
  });

  it('takes the recorded cost, else computes it from the tokens', () => {
    expect(rowCost(row({ costUsd: '0.5', inputTokens: '1' }))).toBe(0.5);
    expect(rowCost(row({ inputTokens: '3562', outputTokens: '5312', calls: '2' }))).toBeCloseTo(
      (3562 * 0.5 + 5312 * 3) / 1e6,
      12,
    );
    expect(rowCost(row({ inputTokens: '', outputTokens: '', calls: '1' }))).toBe(0);
    expect(rowCost(row({ model: 'unknown', inputTokens: '10' }))).toBeUndefined();
  });

  it('chooses the tier from the tokens per call', () => {
    const haiku = { provider: 'anthropic', model: 'claude-haiku-5-5', inputTokens: '150000' };
    expect(rowCost(row({ ...haiku, calls: '1' }))).toBeCloseTo(0.075, 12);
    expect(rowCost(row({ ...haiku, calls: '2' }))).toBeCloseTo(0.015, 12);
  });
});

describe('groupRows', () => {
  it('groups by provider, model and mode, legacy rows under Gemini, in sorted order', () => {
    const groups = groupRows([
      row({ mode: 'estimate' }),
      row({ provider: 'gemini' }),
      row({ provider: 'anthropic', model: 'claude-haiku-5-5' }),
      row({}),
    ]);
    expect(groups.map((g) => [g.provider, g.model, g.mode, g.rows.length])).toEqual([
      ['anthropic', 'claude-haiku-5-5', 'printed', 1],
      ['gemini', 'gemini-3-flash-preview', 'estimate', 1],
      ['gemini', 'gemini-3-flash-preview', 'printed', 2],
    ]);
  });
});

describe('summarizeGroup', () => {
  it('counts runs and plans, means scores over rows that have them, and costs every row', () => {
    const rows = [
      row({
        plan: 'a',
        nameMatch: '1',
        scaleError: '-0.2',
        estimateWithin10: 'true',
        durationMs: '1000',
        costUsd: '0.01',
      }),
      row({
        plan: 'a',
        nameMatch: '0.5',
        scaleError: '0.1',
        estimateWithin10: 'false',
        durationMs: '3000',
        costUsd: '0.03',
      }),
      row({ plan: 'b', status: 'error', durationMs: '2000', inputTokens: '', outputTokens: '' }),
    ];
    const [group] = groupRows(rows);
    const summary = summarizeGroup(group!);
    expect(summary).toMatchObject({
      provider: 'gemini',
      runs: 3,
      plans: 2,
      medianDurationMs: 2000,
      failureRate: 1 / 3,
    });
    expect(summary.p90DurationMs).toBeCloseTo(2800, 9);
    expect(summary.meanCostUsd).toBeCloseTo(0.04 / 3, 12);
    expect(summary.scores.nameMatch).toBe(0.75);
    expect(summary.scores.scaleError).toBeCloseTo(0.15, 12);
    expect(summary.scores.estimateWithin10).toBe(0.5);
    expect(summary.scores.wallLengthError).toBeUndefined();
  });
});

describe('summaryMarkdown', () => {
  it('has a column per group, a row per figure and the prices used', () => {
    const summaries = groupRows([
      row({ nameMatch: '0.5', durationMs: '1000', costUsd: '0.0123' }),
      row({ model: 'mystery', status: 'error' }),
    ]).map(summarizeGroup);
    const text = summaryMarkdown(summaries, 'x.csv');
    const lines = text.split('\n').filter((l) => l.startsWith('|'));
    const cells = lines.map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );
    expect(cells[0]).toEqual([
      '',
      'gemini · gemini-3-flash-preview · printed',
      'gemini · mystery · printed',
    ]);
    const figure = (label: string) => cells.find((c) => c[0] === label)?.slice(1);
    expect(figure('nameMatch (mean)')).toEqual(['0.500', '–']);
    expect(figure('Mean cost per plan (USD)')).toEqual(['$0.0123', '–']);
    expect(figure('Failure rate')).toEqual(['0 %', '100 %']);
    // Padded to equal width, as Prettier formats a table.
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(lines[1]).toMatch(/^\| -+ \| -+: \| -+: \|$/);
    expect(text).toContain('gemini gemini-3-flash-preview: $0.5 in / $3 out per 1M tokens');
    expect(text).not.toContain('mystery: $');
  });
});

describe('writeSummary', () => {
  it('reads a CSV with the old header and one with the new header alike', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'el-karta-summary-'));
    try {
      const old = FLOORPLAN_COLUMNS.filter((c) => c !== 'provider' && c !== 'costUsd');
      const values = {
        plan: 'p',
        model: 'gemini-3-flash-preview',
        mode: 'printed',
        status: 'ok',
        inputTokens: 1_000_000,
        outputTokens: 0,
        calls: 1,
      };
      const legacy =
        csvLine(old) + csvLine(old.map((c) => (values as Record<string, CsvValue>)[c]));
      const current =
        csvLine(FLOORPLAN_COLUMNS) +
        csvLine(
          FLOORPLAN_COLUMNS.map(
            (c) =>
              (({ ...values, provider: 'gemini', costUsd: 0.5 }) as Record<string, CsvValue>)[c],
          ),
        );
      for (const [name, text] of [
        ['old', legacy],
        ['new', current],
      ] as const) {
        await writeFile(join(dir, `${name}.csv`), text);
        const [summary] = await writeSummary(
          join(dir, `${name}.csv`),
          join(dir, `${name}.md`),
          name,
        );
        expect(summary).toMatchObject({ provider: 'gemini', runs: 1, meanCostUsd: 0.5 });
        expect(await readFile(join(dir, `${name}.md`), 'utf8')).toContain('$0.5000');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
