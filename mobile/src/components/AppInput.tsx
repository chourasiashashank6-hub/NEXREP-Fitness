import { StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { useAppTheme } from "../theme";

type Props = TextInputProps & {
  label?: string;
};

export const AppInput = ({ label, ...props }: Props) => {
  const { colors, radius } = useAppTheme();

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: colors.text }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.inputBg },
        ]}
        {...props}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
});
