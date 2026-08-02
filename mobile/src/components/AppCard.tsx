import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useAppTheme } from "../theme";

export const AppCard = ({ children }: PropsWithChildren) => {
  const { colors, radius } = useAppTheme();
  return <View style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.xl, borderColor: colors.border }]}>{children}</View>;
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    marginBottom: 12,
  },
});
