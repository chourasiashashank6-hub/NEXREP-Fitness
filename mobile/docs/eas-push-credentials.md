# EAS Push Credentials

This project is configured to use EAS remote credentials for production builds:

- iOS bundle identifier: `com.nexrep.fitness`
- Android package: `com.nexrep.fitness`
- `eas.json` production builds use `"credentialsSource": "remote"`

To make production Expo push tokens work, configure credentials from an authenticated EAS CLI session:

```sh
cd fitness/mobile
eas credentials
```

Then complete:

1. iOS: add or let EAS manage the APNs key/certificate for `com.nexrep.fitness`.
2. Android: add the Firebase Cloud Messaging service account / FCM credentials for the Firebase project attached to `com.nexrep.fitness`.
3. Set `EXPO_PUBLIC_EAS_PROJECT_ID` in the mobile environment to the EAS project ID so `getExpoPushTokenAsync({ projectId })` can request production-compatible Expo push tokens.

Credential upload cannot be committed to git because APNs and FCM secrets live in EAS/Apple/Google account storage.
