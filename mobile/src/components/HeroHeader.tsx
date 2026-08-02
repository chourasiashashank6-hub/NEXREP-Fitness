import { StyleSheet, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAppTheme } from "../theme";

type Props = {
  title: string;
  subtitle?: string;
};

export const HeroHeader = ({ title, subtitle }: Props) => {
  const { gradient, radius } = useAppTheme();

  return (
    <LinearGradient colors={gradient} style={[styles.wrap, { borderRadius: radius.xl, borderColor: "#22385F" }]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  wrap: {
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
  },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#C7D7F6", marginTop: 4, fontSize: 14 },
});
