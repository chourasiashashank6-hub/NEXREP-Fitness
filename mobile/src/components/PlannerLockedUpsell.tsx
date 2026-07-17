import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import ProGateModal from "./ProGateModal";
import { getRequiredPlan } from "../constants/featureTiers";

type Props = {
  feature: string;
  featureName: string;
  featureDescription: string;
  featureEmoji: string;
  accentColor: string;
};

/** Inline Elite/Pro locked state for Planner tab — opens existing ProGateModal on upgrade. */
export function PlannerLockedUpsell({
  feature,
  featureName,
  featureDescription,
  featureEmoji,
  accentColor,
}: Props) {
  const { t } = useTranslation();
  const [gateOpen, setGateOpen] = useState(false);
  const requiredPlan = getRequiredPlan(feature);
  const isElite = requiredPlan === "elite";

  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: accentColor + "22" }]}>
        <Text style={styles.emoji}>{featureEmoji}</Text>
      </View>
      <View style={styles.lockPill}>
        <Text style={styles.lockPillText}>
          🔒 {isElite ? t("components.proGate.eliteFeature") : t("components.proGate.proFeature")}
        </Text>
      </View>
      <Text style={styles.title}>{featureName}</Text>
      <Text style={styles.body}>{featureDescription}</Text>
      <TouchableOpacity
        style={[styles.upgradeBtn, { backgroundColor: accentColor }]}
        onPress={() => setGateOpen(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.upgradeBtnText}>
          {isElite ? t("components.proGate.upgradeElite") : t("components.proGate.upgradePro")}
        </Text>
      </TouchableOpacity>

      <ProGateModal
        visible={gateOpen}
        onClose={() => setGateOpen(false)}
        featureName={featureName}
        featureDescription={featureDescription}
        featureEmoji={featureEmoji}
        accentColor={accentColor}
        requiredPlan={requiredPlan === "free" ? "pro" : requiredPlan}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emoji: { fontSize: 30 },
  lockPill: {
    backgroundColor: "#FFF8E8",
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 14,
  },
  lockPillText: {
    color: "#B87500",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  title: {
    color: "#1A1A18",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    color: "#888780",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 22,
  },
  upgradeBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: "center",
    minWidth: 220,
  },
  upgradeBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
