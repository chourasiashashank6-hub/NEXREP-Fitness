import "firebase/auth";

/**
 * The web `firebase/auth` typings omit `getReactNativePersistence` (it exists in the React Native
 * bundle that Metro resolves at runtime). This keeps `tsc` aligned with Expo / `@firebase/auth` RN.
 */
declare module "firebase/auth" {
  export function getReactNativePersistence(
    storage: Pick<
      import("@react-native-async-storage/async-storage").default,
      "getItem" | "setItem" | "removeItem"
    >,
  ): import("@firebase/auth").Persistence;
}
