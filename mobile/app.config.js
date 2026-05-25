/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  expo: {
    name: "NexRep",
    slug: "nexrep-fitness",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: false,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.nexrep.fitness",
      infoPlist: {
        NSCameraUsageDescription:
          "NexRep needs camera access to scan food and track workouts.",
        NSPhotoLibraryUsageDescription:
          "NexRep needs photo library access to analyze meal photos.",
      },
    },
    android: {
      package: "com.nexrep.fitness",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      permissions: ["android.permission.CAMERA"],
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: ["@react-native-community/datetimepicker", "expo-image-picker"],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
    },
  },
};
