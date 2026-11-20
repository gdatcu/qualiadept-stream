import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', '.htaccess'],
      manifest: {
        name: 'Qualiadept Stream',
        short_name: 'Qualiadept',
        description: 'Private Cinema powered by Google Drive & Oracle Cloud',
        theme_color: '#06070d',
        background_color: '#06070d',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
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
