# EAS Push Credentials

Android server push needs **two** separate setups:

1. **Client (native app)** — `google-services.json` is compiled into the APK/AAB so `getExpoPushTokenAsync()` can talk to FCM.
2. **Server (Expo/EAS)** — FCM V1 service account uploaded to EAS so Expo can deliver pushes to registered tokens.

Local on-device notifications do **not** use FCM and can work even when server push is misconfigured.

## Project identifiers

- iOS bundle identifier: `com.nexrep.fitness`
- Android package: `com.nexrep.fitness`
- EAS project ID: `3ee03086-5d5a-4b21-b758-a4f8d22b34d6` (set as `EXPO_PUBLIC_EAS_PROJECT_ID`)
- Firebase project: `repwise-8338b`
- `eas.json` production builds use `"credentialsSource": "remote"`

## 1. Android client — `google-services.json`

`mobile/google-services.json` must exist and its `package_name` must be `com.nexrep.fitness`.

`mobile/app.config.js` points at it via:

```js
android: {
  googleServicesFile: path.resolve(__dirname, "google-services.json"),
}
```

**This is a native change.** After adding or changing the file, you must rebuild and reinstall the app:

```sh
cd mobile

# EAS dev client (recommended for day-to-day development)
eas build --profile development --platform android

# Or local native rebuild
npx expo prebuild --clean --platform android
npx expo run:android
```

If you see `Default FirebaseApp is not initialized` when tapping **Test server push**, the installed APK was built **before** FCM client config was included. Rebuild and reinstall; a Metro reload or OTA update is not enough.

Verify prebuild picked up FCM (optional):

```sh
npx expo prebuild --platform android --no-install
# Expect: android/app/google-services.json and apply plugin: 'com.google.gms.google-services' in android/app/build.gradle
```

## 2. Environment — `EXPO_PUBLIC_EAS_PROJECT_ID`

`getExpoPushTokenAsync({ projectId })` needs the EAS project ID at runtime.

- **EAS builds:** set in `eas.json` for each profile (already configured).
- **Local Metro / dev client:** add to `mobile/.env` or `.env.development`:

```env
EXPO_PUBLIC_EAS_PROJECT_ID=3ee03086-5d5a-4b21-b758-a4f8d22b34d6
```

Restart Expo after changing env files.

## 3. Server — EAS FCM credentials

Upload FCM V1 credentials so Expo can send pushes (required for **Test server push** delivery, not for obtaining a token):

```sh
cd mobile
eas credentials
```

Then:

1. **Android** → select the Firebase project for `com.nexrep.fitness` → upload the FCM V1 service account JSON from Firebase Console → Project settings → Service accounts → Generate new private key.
2. **iOS** → add or let EAS manage the APNs key/certificate for `com.nexrep.fitness`.

Guide: https://docs.expo.dev/push-notifications/fcm-credentials/

Credential secrets cannot be committed to git; they live in EAS/Apple/Google account storage.

## Quick checklist

| Step | Symptom if missing |
|------|-------------------|
| `google-services.json` + native rebuild | `FirebaseApp is not initialized` on token registration |
| `EXPO_PUBLIC_EAS_PROJECT_ID` in env | Token request may fail or use wrong project |
| FCM V1 credentials in EAS | Token registers but server test push does not arrive |

## Test flow

1. **Test on-device** — confirms permissions and notification channels (no FCM).
2. **Test server push** — registers Expo push token (needs FCM client build) then asks the API to send via Expo (needs EAS FCM credentials).
