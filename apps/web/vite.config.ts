import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages has no rewrites; serving index.html as 404.html lets deep links reach the router.
function spaFallback(): Plugin {
  let outDir = '';
  return {
    name: 'spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, '../..'), 'VITE_');
  const base = env.VITE_BASE_PATH ?? '/';
  return {
    base,
    envDir: '../..',
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src') },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'El-karta',
          short_name: 'El-karta',
          lang: 'sv',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#0f172a',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          navigateFallback: `${base}index.html`,
        },
      }),
      spaFallback(),
    ],
  };
});
