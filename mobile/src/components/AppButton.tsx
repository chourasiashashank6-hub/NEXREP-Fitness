import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { useAppTheme } from "../theme";

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
};

export const AppButton = ({ label, onPress, loading, disabled, variant = "primary" }: Props) => {
  const { colors, radius } = useAppTheme();
  const isSecondary = variant === "secondary";
  const inactive = Boolean(loading || disabled);

  return (
    <Pressable
      style={[
        styles.button,
        {
          borderRadius: radius.md,
          backgroundColor: isSecondary ? colors.tabBg : colors.primary,
          borderWidth: isSecondary ? 1 : 0,
          borderColor: isSecondary ? colors.border : "transparent",
          opacity: inactive ? 0.45 : 1,
        },
      ]}
      onPress={onPress}
      disabled={inactive}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={[styles.text, { color: isSecondary ? colors.text : colors.background }]}>{label}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    marginTop: 8,
  },
  text: { fontWeight: "700", fontSize: 15 },
});
