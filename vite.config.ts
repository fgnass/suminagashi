import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Suminagashi – floating ink',
        short_name: 'Suminagashi',
        description: 'Float ink on water, comb it, blow on it, then lay paper on it to take a print.',
        theme_color: '#f4f2ee',
        background_color: '#f4f2ee',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // screenshots/ is for gnass.buzz and link previews, not for the app
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,webmanifest}'], globIgnores: ['screenshots/**'] },
    }),
  ],
});
