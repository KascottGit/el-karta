import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'ai-providers',
          root: 'packages/ai-providers',
          include: ['test/**/*.test.ts'],
        },
      },
      { test: { name: 'ai-passes', root: 'packages/ai-passes', include: ['test/**/*.test.ts'] } },
      {
        resolve: { alias: { '@': resolve(import.meta.dirname, 'apps/web/src') } },
        test: { name: 'web', root: 'apps/web', include: ['src/**/*.test.{ts,tsx}'] },
      },
      { test: { name: 'tooling', root: 'tooling', include: ['**/*.test.ts'] } },
      // Needs the local Supabase stack, so it only runs via `pnpm test:integration`.
      ...(process.env['INTEGRATION']
        ? [
            {
              test: {
                name: 'integration',
                root: 'packages/data-supabase',
                include: ['test/**/*.integration.test.ts'],
                testTimeout: 30_000,
              },
            },
          ]
        : []),
    ],
  },
});
