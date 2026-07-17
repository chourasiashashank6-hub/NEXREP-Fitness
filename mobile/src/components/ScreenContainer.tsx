import type { PropsWithChildren, ReactElement } from "react";
import type { RefreshControlProps, StyleProp, ViewStyle } from "react-native";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

const SCREEN_BG = "#FFFFFF";

type ScreenContainerProps = PropsWithChildren<{
  bg?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Skip outer SafeAreaView when embedded inside a Log tab. */
  embedded?: boolean;
}>;

export const ScreenContainer = ({
  children,
  bg = SCREEN_BG,
  style,
  contentStyle,
  refreshControl,
  embedded = false,
}: ScreenContainerProps) => {
  const body = (
    <ScrollView
      style={[styles.root, { backgroundColor: bg }]}
      contentContainerStyle={[styles.content, embedded && styles.contentEmbedded, contentStyle]}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  );

  if (embedded) {
    return <View style={[styles.safeArea, { backgroundColor: bg }, style]}>{body}</View>;
  }

  return <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }, style]}>{body}</SafeAreaView>;
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  contentEmbedded: { paddingTop: 4 },
  inner: { width: "100%", maxWidth: 860, alignSelf: "center" },
});
