import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// The app under test talks to the local Supabase stack, never the hosted project.
const status = JSON.parse(
  execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: new URL('../../..', import.meta.url).pathname,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
) as { API_URL: string; ANON_KEY: string; MAILPIT_URL: string };

process.env['MAILPIT_URL'] = status.MAILPIT_URL;
const port = Number(process.env['E2E_PORT'] ?? 5174);

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    cwd: new URL('..', import.meta.url).pathname,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
      VITE_BASE_PATH: '/',
    },
  },
});
