import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurredModalBackdrop } from "./BlurredModalBackdrop";

type Variant = "center" | "bottom";

type Props = {
  onClose: () => void;
  children: ReactNode;
  variant?: Variant;
  showCloseButton?: boolean;
};

/** Transparent navigation modal shell — same blur backdrop as Game Plan. */
export function BlurredModalScreenShell({
  onClose,
  children,
  variant = "center",
  showCloseButton = true,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <BlurredModalBackdrop onPress={onClose} />
      <View
        pointerEvents="box-none"
        style={[
          variant === "bottom"
            ? [styles.bottomWrap, { paddingBottom: insets.bottom + 12 }]
            : [styles.centerWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }],
        ]}
      >
        {showCloseButton ? (
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button">
              <Ionicons name="close" size={18} color="#1A1A18" />
            </Pressable>
          </View>
        ) : null}
        <View style={variant === "bottom" ? styles.bottomPanel : styles.centerPanel}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  bottomWrap: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 0 },
  centerWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  header: { alignItems: "flex-end", marginBottom: 8, paddingHorizontal: 16 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  centerPanel: {
    flex: 1,
    maxHeight: "92%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
  },
  bottomPanel: {
    maxHeight: "92%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
});
