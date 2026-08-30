/** @type {import('expo/config').ExpoConfig} */
const path = require("path");

require("dotenv").config();
// EAS Build does not upload gitignored `.env`; use committed public client keys.
if (process.env.EAS_BUILD === "true") {
  require("dotenv").config({ path: path.resolve(__dirname, ".env.production"), override: true });
}

const isDevClientBuild = process.env.EAS_BUILD_PROFILE === "development";

module.exports = {
  expo: {
    name: "NexRep",
    slug: "nexrep-fitness",
    owner: "nexrep_5",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.nexrep.fitness",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "NexRep needs camera access to scan food and track workouts.",
        NSPhotoLibraryUsageDescription:
          "NexRep needs photo library access to analyze meal photos.",
        NSLocationWhenInUseUsageDescription:
          "NexRep uses your location to suggest nearby gyms when you search.",
        // Allow WKWebView to load the on-device MediaPipe server at http://127.0.0.1:<port>.
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
      },
    },
    android: {
      package: "com.nexrep.fitness",
      // Baked into the native APK/AAB at prebuild; required for getExpoPushTokenAsync on Android.
      googleServicesFile: path.resolve(__dirname, "google-services.json"),
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      permissions: [
        "android.permission.CAMERA",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.SCHEDULE_EXACT_ALARM",
      ],
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      ...(isDevClientBuild ? ["expo-dev-client"] : []),
      [
        "expo-build-properties",
        {
          android: {
            // Required for the local MediaPipe HTTP server (http://127.0.0.1) on Android 9+.
            usesCleartextTraffic: true,
            // Preview/production APKs are release builds — enable R8 for distribution.
            enableMinifyInReleaseBuilds: true,
          },
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "NexRep needs camera access to scan food and track workouts with pose guidance.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      "@react-native-community/datetimepicker",
      "expo-image-picker",
      "expo-font",
      "expo-localization",
      "expo-secure-store",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "NexRep uses your location to suggest nearby gyms when you search.",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#0F6E56",
          defaultChannel: "logging-nudges",
        },
      ],
    ],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
      },
    },
  },
};
