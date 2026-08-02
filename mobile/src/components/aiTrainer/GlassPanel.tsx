import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { AI_C } from "./aiTrainerTokens";

export function GlassPanel({
  children,
  style,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  glass: {
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
    borderRadius: 18,
    // RN: translucent panel; blur is best-effort via opacity (no BlurView dependency).
  },
});
