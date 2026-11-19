import { describe, expect, it } from 'vitest';
import { BUDGET_MS, measure } from './perf.ts';

describe('performance budget (data layer only; rendering comes on top)', () => {
  it.each(['small', 'medium', 'large'] as const)(
    'opens and traces the %s project within budget',
    (size) => {
      const report = measure(size, 200);
      expect(report.openMs.total).toBeLessThan(BUDGET_MS[size].open);
      expect(report.selectMs.max).toBeLessThan(BUDGET_MS[size].select);
      expect(report.panelDownstreamMs).toBeLessThan(BUDGET_MS[size].select);
    },
  );
});
