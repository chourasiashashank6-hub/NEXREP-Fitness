import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurredModalBackdrop } from "./BlurredModalBackdrop";

type Props = {
  onClose: () => void;
  children: ReactNode;
};

/** Settings drawer — blurred backdrop with a panel anchored to the right edge. */
export function RightDrawerShell({ onClose, children }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <BlurredModalBackdrop onPress={onClose} />
      <View
        pointerEvents="box-none"
        style={[styles.drawerWrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.drawerPanel}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  drawerWrap: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  drawerPanel: {
    width: "92%",
    maxWidth: 420,
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: -4, height: 0 },
    elevation: 8,
  },
});
