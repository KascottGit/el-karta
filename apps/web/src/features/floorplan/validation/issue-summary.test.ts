import { describe, expect, it } from 'vitest';
import { summarizeIssues } from './issue-summary';

describe('summarizeIssues', () => {
  it('counts issues per code in order of first appearance, with the worst severity', () => {
    expect(
      summarizeIssues([
        { code: 'opening.overlap', severity: 'warning' },
        { code: 'opening.outside-wall', severity: 'error' },
        { code: 'opening.overlap', severity: 'warning' },
        { code: 'x.mixed', severity: 'warning' },
        { code: 'x.mixed', severity: 'error' },
      ]),
    ).toEqual([
      { code: 'opening.overlap', severity: 'warning', count: 2 },
      { code: 'opening.outside-wall', severity: 'error', count: 1 },
      { code: 'x.mixed', severity: 'error', count: 2 },
    ]);
    expect(summarizeIssues([])).toEqual([]);
  });

  it('keeps the message parameters of the first issue of a code', () => {
    expect(
      summarizeIssues([
        { code: 'ai.room-merged', severity: 'warning', params: { count: 2 } },
        { code: 'ai.room-merged', severity: 'warning', params: { count: 3 } },
      ]),
    ).toEqual([{ code: 'ai.room-merged', severity: 'warning', count: 2, params: { count: 2 } }]);
  });
});
