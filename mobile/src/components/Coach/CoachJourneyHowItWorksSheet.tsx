import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BlurredModal } from "../BlurredModal";
import { GREEN, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

const MUTED = "#BBBBBB";

type Props = {
  visible: boolean;
  onClose: () => void;
  accentColor?: string;
};

export function CoachJourneyHowItWorksSheet({ visible, onClose, accentColor = GREEN }: Props) {
  const { t } = useTranslation();

  return (
    <BlurredModal visible={visible} onClose={onClose} variant="bottom">
      <View style={styles.sheet}>
        <Text style={styles.title}>{t("coach.journey.howItWorksTitle")}</Text>
        <Text style={styles.body}>{t("coach.journey.howItWorksBody")}</Text>
        <Pressable style={[styles.btn, { backgroundColor: accentColor }]} onPress={onClose}>
          <Text style={styles.btnText}>{t("coach.journey.gotIt")}</Text>
        </Pressable>
      </View>
    </BlurredModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    backgroundColor: WHITE,
  },
  title: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 12 },
  body: { color: MUTED, fontSize: 14, lineHeight: 22, marginBottom: 20 },
  btn: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  btnText: { color: WHITE, fontWeight: "800", fontSize: 14 },
});
