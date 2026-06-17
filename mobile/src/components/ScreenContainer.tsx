import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

const SCREEN_BG = "#FFFFFF";

type ScreenContainerProps = PropsWithChildren<{
  bg?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export const ScreenContainer = ({ children, bg = SCREEN_BG, style, contentStyle }: ScreenContainerProps) => {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }, style]}>
      <ScrollView
        style={[styles.root, { backgroundColor: bg }]}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  inner: { width: "100%", maxWidth: 860, alignSelf: "center" },
});
