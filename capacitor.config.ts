import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.globalconnect.dating',
  appName: 'GlobalConnect Dating',
  webDir: '../frontend/dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
