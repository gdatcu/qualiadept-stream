import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-32x32.png', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '.htaccess'],
      manifest: {
        name: 'Qualiadept Stream',
        short_name: 'Qualiadept',
        description: 'Private Cinema powered by Google Drive & Oracle Cloud',
        theme_color: '#070812',
        background_color: '#070812',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  base: './',
  server: {
    port: 5173,
    host: true,
  },
});
