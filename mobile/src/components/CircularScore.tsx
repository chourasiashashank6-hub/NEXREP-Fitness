import Svg, { Circle } from "react-native-svg";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../theme";

type Props = { score: number };

export const CircularScore = ({ score }: Props) => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score));
  const offset = circumference - (progress / 100) * circumference;

  return (
    <View style={styles.wrap}>
      <Svg width={110} height={110}>
        <Circle cx="55" cy="55" r={radius} stroke="#DCE7E6" strokeWidth="10" fill="none" />
        <Circle
          cx="55"
          cy="55"
          r={radius}
          stroke={colors.secondary}
          strokeWidth="10"
          fill="none"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.value, { color: colors.text }]}>{progress}</Text>
        <Text style={[styles.label, { color: colors.muted }]}>{t("components.score")}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center" },
  value: { fontWeight: "800", fontSize: 20 },
  label: { fontSize: 12 },
});
