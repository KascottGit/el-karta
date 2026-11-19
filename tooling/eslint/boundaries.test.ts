import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { boundaries } from './boundaries.js';

const eslint = new ESLint({
  cwd: new URL('../..', import.meta.url).pathname,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...boundaries,
  ],
});

async function lint(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result!.messages.map((m) => m.ruleId);
}

describe('import boundaries', () => {
  it.each([
    "import { power } from '@el-karta/plugin-power';",
    "import { repo } from '@el-karta/data-supabase';",
    "import { App } from '@el-karta/web';",
    "import { x } from '../../plugin-power/src/index.ts';",
    "import { x } from '../../../apps/web/src/main.tsx';",
  ])('forbids core from: %s', async (source) => {
    expect(await lint('packages/core/src/probe.ts', source)).toEqual(['no-restricted-imports']);
  });

  it('forbids plugins from importing other plugins or data adapters', async () => {
    expect(
      await lint(
        'packages/plugin-network/src/probe.ts',
        "import { p } from '@el-karta/plugin-power';",
      ),
    ).toEqual(['no-restricted-imports']);
    expect(
      await lint(
        'packages/plugin-network/src/probe.ts',
        "import { d } from '@el-karta/data-supabase';",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows the intended dependencies', async () => {
    expect(
      await lint(
        'packages/core/src/probe.ts',
        "import { z } from 'zod';\nimport { x } from './model.ts';",
      ),
    ).toEqual([]);
    expect(
      await lint(
        'packages/plugin-power/src/probe.ts',
        "import { buildGraph } from '@el-karta/core';",
      ),
    ).toEqual([]);
    expect(
      await lint('apps/web/src/probe.ts', "import { p } from '@el-karta/plugin-power';"),
    ).toEqual([]);
  });
});
