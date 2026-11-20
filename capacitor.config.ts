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
};

export default config;
