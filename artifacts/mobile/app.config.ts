import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.config.ts — single source of truth for Expo configuration.
 *
 * Build-time env vars (set via EAS secrets or local .env):
 *   EXPO_PUBLIC_GOOGLE_MAPS_KEY  — Google Maps / Places / Directions API key
 *   EXPO_PUBLIC_DOMAIN           — Hostname of the deployed API server
 *                                  e.g. "my-repl.replit.app" (no protocol)
 *
 * Both vars are also read at runtime by the JS bundle, so they must be
 * prefixed EXPO_PUBLIC_ so the Expo Metro bundler inlines them.
 */

const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';
const apiDomain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  // ── Identity ────────────────────────────────────────────────────────────
  name: 'MetroEast RideLink',
  slug: 'ridelink',
  version: '1.0.0',

  // Deep-link scheme  →  ridelink://
  scheme: 'ridelink',

  // ── Display ─────────────────────────────────────────────────────────────
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',

  // ── New Architecture (Fabric + TurboModules) ─────────────────────────────
  newArchEnabled: true,

  // ── Splash screen ────────────────────────────────────────────────────────
  splash: {
    image: './assets/images/icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0D14',
  },

  // ── iOS ─────────────────────────────────────────────────────────────────
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.metroeast.ridelink',
    buildNumber: '1',
    infoPlist: {
      // Foreground location (required for map + group presence)
      NSLocationWhenInUseUsageDescription:
        'RideLink uses your location to show your position on the group map and track your ride distance and speed.',
      // Background location permission string (required to show the "Always" option)
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'RideLink uses your location in the background to share your position with your ride group and record your route.',
      NSLocationAlwaysUsageDescription:
        'RideLink uses your location in the background to keep your group updated even when the screen is off.',
      // Microphone for group voice chat
      NSMicrophoneUsageDescription:
        'RideLink uses your microphone for hands-free group voice chat while riding.',
      // Notification permission string
      NSUserNotificationUsageDescription:
        'RideLink sends notifications for ride invites and group updates.',
    },
    config: {
      googleMapsApiKey: mapsKey,
    },
  },

  // ── Android ─────────────────────────────────────────────────────────────
  android: {
    package: 'com.metroeast.ridelink',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/icon.png',
      backgroundColor: '#0A0D14',
    },
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      // Background location — declared here so Play Store listing shows it.
      // The user is prompted separately for "Allow all the time" at runtime.
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
    config: {
      googleMaps: {
        apiKey: mapsKey,
      },
    },
  },

  // ── Web ─────────────────────────────────────────────────────────────────
  web: {
    favicon: './assets/images/icon.png',
  },

  // ── Plugins ─────────────────────────────────────────────────────────────
  plugins: [
    [
      'expo-router',
      {
        // Remove the Replit-specific origin for production builds.
        // Set EXPO_PUBLIC_DOMAIN if you need universal-link support.
        ...(apiDomain ? { origin: `https://${apiDomain}` } : {}),
      },
    ],
    'expo-font',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'RideLink uses your location to show your position on the group map and track your ride.',
        locationAlwaysAndWhenInUsePermission:
          'RideLink uses your location in the background to share your position with your ride group.',
        locationAlwaysPermission:
          'RideLink uses your location in the background to keep your group updated even when the screen is off.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#F5570C',
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          // Maps SDK requires iOS 15+
          deploymentTarget: '15.1',
          useFrameworks: 'static',
        },
        android: {
          // Maps SDK requires SDK 24+
          minSdkVersion: 24,
          targetSdkVersion: 35,
          compileSdkVersion: 35,
          // Enable multidex for large dependency tree
          enableMultiDex: true,
        },
      },
    ],
  ],

  // ── Experiments ──────────────────────────────────────────────────────────
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  // ── Extra (runtime-accessible via Constants.expoConfig.extra) ─────────────
  extra: {
    // Passed to the JS bundle; access via expo-constants at runtime if needed.
    apiDomain,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? '',
    },
  },
});
