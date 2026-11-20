const ELLIPSIS = '…';

/** The longest start of `text` that fits in `widthPx`, with an ellipsis if it was cut. */
export function fitText(text: string, widthPx: number, measureText: (s: string) => number) {
  if (measureText(text) <= widthPx) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid) + ELLIPSIS) <= widthPx) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ELLIPSIS : '';
}
