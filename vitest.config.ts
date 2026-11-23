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
        test: {
          name: 'plugin-furnishing',
          root: 'packages/plugin-furnishing',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: { '@': resolve(import.meta.dirname, 'apps/web/src') } },
        test: { name: 'web', root: 'apps/web', include: ['src/**/*.test.{ts,tsx}'] },
      },
      { test: { name: 'tooling', root: 'tooling', include: ['**/*.test.ts'] } },
      // Deno code; the aliases mirror the import map in supabase/functions/deno.json.
      {
        resolve: {
          alias: {
            '@el-karta/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
            '@el-karta/ai-passes': resolve(import.meta.dirname, 'packages/ai-passes/src/index.ts'),
            '@el-karta/ai-providers': resolve(
              import.meta.dirname,
              'packages/ai-providers/src/index.ts',
            ),
            '@el-karta/data-supabase': resolve(
              import.meta.dirname,
              'packages/data-supabase/src/index.ts',
            ),
            zod: resolve(import.meta.dirname, 'packages/data-supabase/node_modules/zod'),
          },
        },
        test: { name: 'functions', root: 'supabase/functions', include: ['**/*.test.ts'] },
      },
      // Renders a PDF page with pdf.js, which takes a few seconds.
      {
        test: { name: 'evals', root: 'evals', include: ['test/**/*.test.ts'], testTimeout: 30_000 },
      },
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
