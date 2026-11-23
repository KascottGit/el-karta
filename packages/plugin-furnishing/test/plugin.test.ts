import { createRegistry } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { furnishingPlugin } from '../src/index.ts';

describe('furnishingPlugin', () => {
  it('registers', () => {
    expect(createRegistry([furnishingPlugin]).plugin('furnishing')).toBe(furnishingPlugin);
  });
});
