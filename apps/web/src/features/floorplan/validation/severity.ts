import type { IssueSeverity } from '@el-karta/core';

/** The most severe level among an item's issues, for colouring it, or null without issues. */
export function worstSeverity(
  issues: readonly { severity: IssueSeverity }[] | undefined,
): IssueSeverity | null {
  if (!issues?.length) return null;
  return issues.some((i) => i.severity === 'error') ? 'error' : 'warning';
}
