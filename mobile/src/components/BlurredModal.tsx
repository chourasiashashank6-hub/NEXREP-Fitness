import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurredModalBackdrop } from "./BlurredModalBackdrop";

type Variant = "center" | "bottom";

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  variant?: Variant;
  statusBarTranslucent?: boolean;
  sheetStyle?: ViewStyle;
  backdropAccessibilityLabel?: string;
};

export function BlurredModal({
  visible,
  onClose,
  children,
  variant = "bottom",
  statusBarTranslucent = true,
  sheetStyle,
  backdropAccessibilityLabel,
}: Props) {
  const insets = useSafeAreaInsets();
  const animationType = variant === "bottom" ? "slide" : "fade";

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onClose}
      statusBarTranslucent={statusBarTranslucent}
    >
      <View style={styles.root}>
        <BlurredModalBackdrop onPress={onClose} accessibilityLabel={backdropAccessibilityLabel} />
        <View
          pointerEvents="box-none"
          style={[
            variant === "bottom"
              ? [styles.bottomWrap, { paddingBottom: Math.max(insets.bottom, 12) }]
              : [styles.centerWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }],
          ]}
        >
          <Pressable
            style={[variant === "bottom" ? styles.bottomSheet : styles.centerSheet, sheetStyle]}
            onPress={(event) => event.stopPropagation()}
          >
            {children}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  bottomWrap: { flex: 1, justifyContent: "flex-end" },
  centerWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  bottomSheet: {
    maxHeight: "88%",
    minHeight: "62%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  centerSheet: {
    width: "100%",
    maxHeight: "88%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
  },
});
