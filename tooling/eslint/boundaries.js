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
      '@el-karta/ai-*',
      '@el-karta/agent-tools',
      '**/plugin-*/**',
      '**/data-*/**',
      '**/ai-*/**',
      '**/agent-tools/**',
    ],
    message:
      'packages/core must not depend on plugins, data adapters, AI passes or providers, agent tools or apps.',
  },
  {
    name: 'plugins',
    files: ['packages/plugin-*/**/*.{ts,tsx,js}'],
    group: ['@el-karta/plugin-*', '@el-karta/data-*', '@el-karta/ai-*', '@el-karta/agent-tools'],
    message: 'Plugins may depend on @el-karta/core only.',
  },
  {
    name: 'data',
    files: ['packages/data-*/**/*.{ts,tsx,js}'],
    group: ['@el-karta/plugin-*', '@el-karta/ai-*', '@el-karta/agent-tools'],
    message: 'Data adapters may depend on @el-karta/core only.',
  },
  {
    name: 'ai-providers',
    files: ['packages/ai-providers/**/*.{ts,tsx,js}'],
    group: ['@el-karta/*'],
    message: 'AI providers must not depend on other workspace packages.',
  },
  {
    name: 'ai-passes',
    files: ['packages/ai-passes/**/*.{ts,tsx,js}'],
    group: ['@el-karta/plugin-*', '@el-karta/data-*', '@el-karta/agent-tools'],
    message: 'AI passes may depend on @el-karta/core and @el-karta/ai-providers only.',
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
