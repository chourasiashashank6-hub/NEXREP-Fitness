import { Platform } from "react-native";

/** iOS keeps horizontal insets; Android/web report bogus side insets that shrink layout. */
export const SCREEN_SAFE_AREA_EDGES =
  Platform.OS === "ios" ? (["top", "left", "right"] as const) : (["top"] as const);
