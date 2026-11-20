import type { CapacitorConfig } from '@capacitor/cli';

// Note: `webDir: 'public'` is only a fallback bundle; real loading comes from `server.url` (remote shell at stapp.com.ar).
const config: CapacitorConfig = {
  appId: 'ar.com.stapp.app',
  appName: 'STApp',
  webDir: 'public',
  server: {
    // The apex is the canonical host (canonical, sitemap, robots, App Links).
    // It must be the primary Vercel domain: the native bridge is only
    // registered natively for the server.url origin, so a redirect to another
    // host strands the page without it.
    url: 'https://stapp.com.ar/app-entry',
    cleartext: false,
    allowNavigation: ['*.stapp.com.ar', 'stapp.com.ar'],
  },
  plugins: {
    SplashScreen: {
      // The web hides the splash as soon as React mounts (hideSplashScreen).
      // Auto-hide is the fallback: if the bridge never reaches the page, the
      // splash still closes instead of leaving the app stuck on the logo.
      launchShowDuration: 6000,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: true,
      spinnerColor: '#3b82f6',
    },
    StatusBar: {
      backgroundColor: '#ffffff',
      style: 'DARK',
      overlaysWebView: false,
    },
    Camera: {
      permissions: ['camera', 'photos'],
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
