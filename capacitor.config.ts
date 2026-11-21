import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'eu.qualiadept.stream',
  appName: 'Qualiadept Stream',
  webDir: 'dist',
  backgroundColor: '#06070d',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#06070d',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
      hidden: false,
    },
  },
};

export default config;
