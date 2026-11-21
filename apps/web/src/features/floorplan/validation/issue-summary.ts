import type { Issue, IssueSeverity } from '@el-karta/core';

/** The issues of one code on the selected items, with the worst severity among them. */
export interface IssueSummary {
  code: string;
  severity: IssueSeverity;
  count: number;
  /** Message parameters of the first issue of this code, such as a suggestion's printed area. */
  params?: Readonly<Record<string, string | number>>;
}

/** Groups issues by code, in order of first appearance, counting them. */
export function summarizeIssues(
  issues: Iterable<Pick<Issue, 'code' | 'severity'> & Pick<IssueSummary, 'params'>>,
): IssueSummary[] {
  const byCode = new Map<string, IssueSummary>();
  for (const { code, severity, params } of issues) {
    const seen = byCode.get(code);
    if (!seen) byCode.set(code, { code, severity, count: 1, ...(params ? { params } : {}) });
    else {
      seen.count++;
      if (severity === 'error') seen.severity = 'error';
    }
  }
  return [...byCode.values()];
}
