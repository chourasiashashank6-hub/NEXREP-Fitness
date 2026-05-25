/**
 * Default module for TypeScript and non-Metro tooling. Metro picks `firebase.web.ts` / `firebase.native.ts`
 * first when bundling; see Expo platform-specific extensions.
 */
export { auth, default } from "./firebase.web";
