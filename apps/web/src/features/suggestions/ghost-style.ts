import type { IssueSeverity } from '@el-karta/core';
import { canvasColors, issueColors, suggestionStyle } from '@/features/floorplan/canvas/theme';

export type ConfidenceTier = keyof typeof suggestionStyle.stroke;

/** A suggestion without a confidence counts as low, so it never looks surer than it is. */
export function confidenceTier(confidence: number | undefined): ConfidenceTier {
  const { high, medium } = suggestionStyle.thresholds;
  if (confidence === undefined || confidence < medium) return 'low';
  return confidence >= high ? 'high' : 'medium';
}

/** Selection first, then the worst issue, then the confidence. */
export function ghostColor(
  confidence: number | undefined,
  severity: IssueSeverity | null,
  selected: boolean,
): string {
  if (selected) return canvasColors.selected;
  if (severity) return issueColors[severity];
  return suggestionStyle.stroke[confidenceTier(confidence)];
}

/** `#rrggbb` with an alpha, for translucent fills. */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)}, ${String(alpha)})`;
}
