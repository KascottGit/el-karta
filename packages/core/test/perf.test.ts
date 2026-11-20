import { describe, expect, it } from 'vitest';
import { BUDGET_MS, measure } from './perf.ts';

// The full suite runs test files in parallel, so timings share the CPU. The exact budget is
// asserted with PERF_BUDGET=1 (like the e2e perf specs); otherwise a loose bound catches regressions.
const slack = process.env['PERF_BUDGET'] === '1' ? 1 : 5;

describe(
  'performance budget (data layer only; rendering comes on top)',
  { timeout: 30_000 },
  () => {
    it.each(['small', 'medium', 'large'] as const)(
      'opens and traces the %s project within budget',
      (size) => {
        const report = measure(size, 200);
        expect(report.openMs.total).toBeLessThan(BUDGET_MS[size].open * slack);
        expect(report.selectMs.max).toBeLessThan(BUDGET_MS[size].select * slack);
        expect(report.panelDownstreamMs).toBeLessThan(BUDGET_MS[size].select * slack);
        expect(report.editMs.p95).toBeLessThan(BUDGET_MS[size].edit * slack);
      },
    );
  },
);
