import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for OverSeek Companion native apps.
 * 
 * Why these settings:
 * - androidScheme/iosScheme: 'https' ensures cookies and localStorage work correctly
 * - PushNotifications: Configure how notifications appear when app is in foreground
 * - SplashScreen: Custom loading experience matching brand colors
 * - Keyboard: Proper viewport handling for mobile forms
 */
const config: CapacitorConfig = {
  appId: 'com.overseek.companion',
  appName: 'OverSeek Companion',
  webDir: 'dist',

  // Use HTTPS scheme to ensure cookies, localStorage, and secure contexts work properly
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    }
  },

  server: {
    // For production builds, use bundled assets
    androidScheme: 'https',
    iosScheme: 'https',

    // Uncomment for development with live reload:
    // url: 'http://192.168.1.X:5173',
    // cleartext: true,
  },

  plugins: {
    PushNotifications: {
      // Show badge, sound, and alert when notification arrives in foreground
      presentationOptions: ['badge', 'sound', 'alert']
    },

    SplashScreen: {
      // Match the app's dark theme
      launchAutoHide: false, // We'll hide it manually after auth check
      backgroundColor: '#0f172a', // slate-900
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    },

    StatusBar: {
      // Dark content on light backgrounds, light content on dark backgrounds
      style: 'DARK', // 'DARK' = light icons for dark backgrounds
      backgroundColor: '#0f172a'
    },

    Keyboard: {
      // Resize the viewport when keyboard appears
      resize: 'body',
      resizeOnFullScreen: true
    }
  }
};

export default config;
