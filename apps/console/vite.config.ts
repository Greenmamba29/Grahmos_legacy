import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Offline-first by construction: every build asset is precached at install; venue packs are
 * cached on first successful load (CacheFirst) and served from cache thereafter. Nothing in the
 * shell references a third-party runtime host — `npm run gates` enforces that.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png', 'packs/*.zip'],
      manifest: {
        name: 'TerraNova Console',
        short_name: 'TerraNova',
        description: 'Offline-first emergency communications and SafetyMap console.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,zip,json}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Provisioning takes effect on the FIRST visit: the worker claims the page as soon as it
        // activates, so one online load is enough to make the device offline-capable.
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/packs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'terranova-packs-v1', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
