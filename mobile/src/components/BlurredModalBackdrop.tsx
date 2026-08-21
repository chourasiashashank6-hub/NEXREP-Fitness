import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, View, type StyleProp, ViewStyle } from "react-native";

/** Matches GamePlanModalScreen — real blur via expo-blur plus a light scrim fallback. */
export const BLUR_MODAL_SCRIM = "rgba(20, 20, 18, 0.28)";
export const BLUR_MODAL_INTENSITY = 40;

type Props = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function BlurredModalBackdrop({ onPress, style, accessibilityLabel = "Close" }: Props) {
  return (
    <Pressable
      style={[StyleSheet.absoluteFill, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[StyleSheet.absoluteFill, styles.scrimFallback]} pointerEvents="none" />
      <BlurView
        intensity={BLUR_MODAL_INTENSITY}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrimFallback: { backgroundColor: BLUR_MODAL_SCRIM },
});
