import { describe, expect, it } from 'vitest';
import { PDF_LONG_SIDE, PDF_MAX_PIXELS, pdfRenderScale } from '../../src/index.ts';

describe('pdfRenderScale', () => {
  it('renders a PDF page with its long side at the tracing resolution', () => {
    // A4 landscape at 72 units per inch.
    const scale = pdfRenderScale(842, 595);
    expect(842 * scale).toBeCloseTo(PDF_LONG_SIDE, 6);
    expect(842 * scale * 595 * scale).toBeLessThanOrEqual(PDF_MAX_PIXELS);
  });

  it('caps the pixel count for square pages', () => {
    const scale = pdfRenderScale(1000, 1000, 5000);
    expect(1000 * scale * 1000 * scale).toBeCloseTo(PDF_MAX_PIXELS, 0);
    expect(1000 * scale).toBeLessThan(5000);
  });
});
