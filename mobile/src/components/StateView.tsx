import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { GREEN, BG, BORDER, TEXT, MUTED } from "../theme/colors";

type Props = {
  state: "loading" | "failed" | "empty";
  title?: string;
  body?: string;
  waking?: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
  lastUpdatedAt?: number | null;
};

export function StateView({
  state,
  title,
  body,
  waking = false,
  onRetry,
  retryDisabled = false,
  lastUpdatedAt,
}: Props) {
  const { t } = useTranslation();

  if (state === "loading") {
    return (
      <View style={styles.box}>
        <ActivityIndicator color={GREEN} />
        <Text style={styles.body}>{waking ? t("offline.errors.wakingBody") : t("offline.state.loading")}</Text>
      </View>
    );
  }

  if (state === "empty") {
    return (
      <View style={styles.box}>
        <Text style={styles.title}>{title ?? t("offline.state.emptyTitle")}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title ?? t("offline.errors.genericTitle")}</Text>
      <Text style={styles.body}>{body ?? t("offline.errors.generic")}</Text>
      {lastUpdatedAt ? (
        <Text style={styles.stale}>
          {t("offline.state.lastUpdated", {
            time: new Date(lastUpdatedAt).toLocaleString(),
          })}
        </Text>
      ) : null}
      {onRetry && !waking ? (
        <Pressable
          style={[styles.retryBtn, retryDisabled && styles.retryDisabled]}
          onPress={onRetry}
          disabled={retryDisabled}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>{t("common.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    alignItems: "center",
  },
  title: { color: TEXT, fontSize: 14, fontWeight: "800", textAlign: "center" },
  body: { color: MUTED, fontSize: 12, lineHeight: 18, textAlign: "center" },
  stale: { color: MUTED, fontSize: 11, fontWeight: "600", textAlign: "center" },
  retryBtn: {
    marginTop: 4,
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryDisabled: { opacity: 0.5 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});
