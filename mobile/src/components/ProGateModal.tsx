import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

type Props = {
  visible: boolean;
  onClose: () => void;
  featureName: string;
  featureDescription: string;
  featureEmoji: string;
  accentColor?: string;
  requiredPlan?: "pro" | "elite";
};

export default function ProGateModal({
  visible,
  onClose,
  featureName,
  featureDescription,
  featureEmoji,
  accentColor = "#1d9e75",
  requiredPlan = "pro",
}: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isElite = requiredPlan === "elite";
  const benefits = t(isElite ? "components.proGate.eliteBenefits" : "components.proGate.proBenefits", { returnObjects: true }) as string[];

  const openSubscription = () => {
    onClose();
    const parent = navigation.getParent?.();
    if (parent) {
      parent.navigate("Profile", { screen: "Subscription" });
      return;
    }
    navigation.navigate("Subscription");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.iconRow}>
          <View style={[styles.iconWrap, { backgroundColor: accentColor + "22" }]}>
            <Text style={styles.iconEmoji}>{featureEmoji}</Text>
          </View>
          <View style={styles.lockBadge}>
            <Text style={styles.lockEmoji}>🔒</Text>
            <Text style={styles.lockText}>{isElite ? t("components.proGate.eliteFeature") : t("components.proGate.proFeature")}</Text>
          </View>
        </View>

        <Text style={styles.title}>{featureName}</Text>
        <Text style={styles.description}>{featureDescription}</Text>

        <View style={styles.benefitsBox}>
          <Text style={styles.benefitsTitle}>{isElite ? t("components.proGate.eliteBenefitsTitle") : t("components.proGate.proBenefitsTitle")}</Text>
          {benefits.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <Text style={[styles.tick, { color: accentColor }]}>✓</Text>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.priceLine}>
          {isElite ? (
            <>
              {t("components.proGate.elitePricePrefix")}<Text style={[styles.priceHighlight, { color: accentColor }]}>{t("components.proGate.elitePrice")}</Text>
            </>
          ) : (
            <>
              {t("components.proGate.proPricePrefix")}<Text style={[styles.priceHighlight, { color: accentColor }]}>{t("components.proGate.proPrice")}</Text>
              {"  ·  "}{t("components.proGate.elitePricePrefix")}<Text style={styles.priceHighlight}>{t("components.proGate.elitePrice")}</Text>
            </>
          )}
        </Text>

        <TouchableOpacity
          style={[styles.upgradeBtn, { backgroundColor: accentColor }]}
          onPress={openSubscription}
          activeOpacity={0.85}
        >
          <Text style={styles.upgradeBtnText}>{isElite ? t("components.proGate.upgradeElite") : t("components.proGate.upgradePro")}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>{t("components.proGate.maybeLater")}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  sheet: {
    backgroundColor: "#161b22",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0.5,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 24,
    paddingBottom: 44,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 22,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: { fontSize: 26 },
  lockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  lockEmoji: { fontSize: 13 },
  lockText: {
    color: "#c9d1d9",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  description: {
    color: "#8b949e",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 18,
  },
  benefitsBox: {
    backgroundColor: "#0d1117",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  benefitsTitle: {
    color: "#6e7681",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  tick: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 1,
  },
  benefitText: {
    color: "#c9d1d9",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  priceLine: {
    color: "#6e7681",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 16,
  },
  priceHighlight: {
    color: "#3fcf8e",
    fontWeight: "700",
  },
  upgradeBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  upgradeBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  cancelText: {
    color: "#6e7681",
    fontSize: 14,
  },
});
