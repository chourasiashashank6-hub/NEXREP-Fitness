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
        NSLocationWhenInUseUsageDescription:
          "NexRep uses your location to suggest nearby gyms when you search.",
      },
    },
    android: {
      package: "com.nexrep.fitness",
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
      "@react-native-community/datetimepicker",
      "expo-image-picker",
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
