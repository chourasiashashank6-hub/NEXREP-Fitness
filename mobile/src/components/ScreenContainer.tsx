import { PropsWithChildren } from "react";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

const HOME_BG = "#080c12";

export const ScreenContainer = ({ children }: PropsWithChildren) => {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: HOME_BG }]}>
      <ScrollView
        style={[styles.root, { backgroundColor: HOME_BG }]}
        contentContainerStyle={styles.content}
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
