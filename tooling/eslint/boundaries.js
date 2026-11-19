// Import boundaries between workspace layers. Exported separately so a test can lint against it directly.
// Flat config does not merge rule options, so each layer lists its full set of restrictions.

const apps = { group: ['@el-karta/web', '@el-karta/mcp', '**/apps/**'] };

const layers = [
  {
    name: 'core',
    files: ['packages/core/**/*.{ts,tsx,js}'],
    group: [
      '@el-karta/plugin-*',
      '@el-karta/data-*',
      '@el-karta/ai-passes',
      '@el-karta/agent-tools',
      '**/plugin-*/**',
      '**/data-*/**',
      '**/ai-passes/**',
      '**/agent-tools/**',
    ],
    message:
      'packages/core must not depend on plugins, data adapters, AI passes, agent tools or apps.',
  },
  {
    name: 'plugins',
    files: ['packages/plugin-*/**/*.{ts,tsx,js}'],
    group: [
      '@el-karta/plugin-*',
      '@el-karta/data-*',
      '@el-karta/ai-passes',
      '@el-karta/agent-tools',
    ],
    message: 'Plugins may depend on @el-karta/core only.',
  },
  {
    name: 'data',
    files: ['packages/data-*/**/*.{ts,tsx,js}'],
    group: ['@el-karta/plugin-*', '@el-karta/ai-passes', '@el-karta/agent-tools'],
    message: 'Data adapters may depend on @el-karta/core only.',
  },
];

/** @type {import("eslint").Linter.Config[]} */
export const boundaries = layers.map(({ name, files, group, message }) => ({
  name: `el-karta/boundaries/${name}`,
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group, message },
          { ...apps, message },
        ],
      },
    ],
  },
}));
