import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CoachCadence } from "../../hooks/useCoachRedesign";

const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const BG = "#F7F6F3";

type Props = {
  cadence: Extract<CoachCadence, "weekly" | "monthly">;
};

/** Phase 1 shell — Phase 2 replaces this with rule-engine views. */
export function CoachCadencePlaceholder({ cadence }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{t(`coach.redesign.placeholder.${cadence}.kicker`)}</Text>
      <Text style={styles.title}>{t(`coach.redesign.placeholder.${cadence}.title`)}</Text>
      <Text style={styles.body}>{t(`coach.redesign.placeholder.${cadence}.body`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 18,
    padding: 20,
    marginBottom: 12,
  },
  kicker: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  body: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
});
