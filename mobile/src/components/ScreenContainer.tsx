import type { PropsWithChildren, ReactElement } from "react";
import type { RefreshControlProps, StyleProp, ViewStyle } from "react-native";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SCREEN_BG = "#FFFFFF";

type ScreenContainerProps = PropsWithChildren<{
  bg?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Skip outer SafeAreaView when embedded inside a Log tab. */
  embedded?: boolean;
  /** When false, children render in a flex View instead of an outer ScrollView. */
  scroll?: boolean;
}>;

export const ScreenContainer = ({
  children,
  bg = SCREEN_BG,
  style,
  contentStyle,
  refreshControl,
  embedded = false,
  scroll = true,
}: ScreenContainerProps) => {
  const body = scroll ? (
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
  ) : (
    <View style={[styles.root, styles.content, embedded && styles.contentEmbedded, contentStyle, { backgroundColor: bg }]}>
      <View style={styles.inner}>{children}</View>
    </View>
  );

  if (embedded) {
    return <View style={[styles.safeArea, { backgroundColor: bg }, style]}>{body}</View>;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }, style]} edges={["top", "left", "right"]}>
      {body}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  contentEmbedded: { paddingTop: 4 },
  inner: { width: "100%", maxWidth: 860, alignSelf: "center" },
});
