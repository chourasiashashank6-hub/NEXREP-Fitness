import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import {
  AppState,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { setupNotificationChannels } from "./src/services/notificationService";
import { bootstrapFeatureTiers } from "./src/hooks/useCoachRedesign";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./src/i18n";
import i18n from "./src/i18n";
import { RootNavigator } from "./src/navigation/RootNavigator";
import NotificationDeepLinkHandler from "./src/navigation/NotificationDeepLinkHandler";
import { flushPendingNotificationNavigation, navigationRef } from "./src/navigation/navigationRef";
import { NotificationPermissionBanner } from "./src/components/NotificationPermissionBanner";
import { AppThemeProvider } from "./src/theme";
import { useLanguageStore } from "./src/i18n/languageStore";
import { useAuthStore } from "./src/store/authStore";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={errorStyles.wrap}>
          <ScrollView contentContainerStyle={errorStyles.content}>
            <Text style={errorStyles.title}>{i18n.t("app.errorBoundary.title")}</Text>
            <Text style={errorStyles.message}>{this.state.error.message}</Text>
            <Text style={errorStyles.hint}>{i18n.t("app.errorBoundary.hint")}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24 },
  title: { fontSize: 18, fontWeight: "700", color: "#c00", marginBottom: 12 },
  message: { fontSize: 13, color: "#333", marginBottom: 12 },
  hint: { fontSize: 12, color: "#666" },
});

let typographyAdjusted = false;
if (!typographyAdjusted) {
  typographyAdjusted = true;
  // Global responsive typography for consistent, screen-fitting text.
  const { width } = Dimensions.get("window");
  const baseWidth = 390; // iPhone 12/13/14 baseline
  const widthScale = width / baseWidth;
  const clampedScale = Math.min(1.02, Math.max(0.9, widthScale));

  (StyleSheet as any).setStyleAttributePreprocessor?.("fontSize", (value: unknown) => {
    if (typeof value !== "number") return value;
    return Math.max(10, Math.round(value * clampedScale));
  });
}

function I18nBootstrap() {
  const token = useAuthStore((s) => s.token);
  const explicitLanguage = useLanguageStore((s) => s.explicitLanguage);
  const syncPending = useLanguageStore((s) => s.syncPending);
  const bootstrapLanguage = useLanguageStore((s) => s.bootstrap);
  const syncExplicitLanguage = useLanguageStore((s) => s.syncExplicitLanguage);

  useEffect(() => {
    void bootstrapLanguage();
  }, [bootstrapLanguage]);

  useEffect(() => {
    if (token && explicitLanguage && syncPending) {
      void syncExplicitLanguage();
    }
  }, [explicitLanguage, syncExplicitLanguage, syncPending, token]);

  useEffect(() => {
    if (!token) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void syncExplicitLanguage();
      }
    });
    return () => subscription.remove();
  }, [syncExplicitLanguage, token]);

  return null;
}

export default function App() {
  // Re-render on browser resize so RN Web recalculates % widths instead of
  // staying locked to the initial Dimensions.get("window") pixel width.
  useWindowDimensions();

  useEffect(() => {
    void setupNotificationChannels().catch(() => undefined);
    void bootstrapFeatureTiers();
  }, []);

  return (
    <AppErrorBoundary>
      <SafeAreaProvider style={styles.root}>
        <AppThemeProvider>
          <I18nBootstrap />
          <NavigationContainer ref={navigationRef} onReady={flushPendingNotificationNavigation}>
            <StatusBar style="dark" />
            <NotificationPermissionBanner />
            <NotificationDeepLinkHandler />
            <RootNavigator />
          </NavigationContainer>
        </AppThemeProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: "100%",
    ...(Platform.OS === "web" ? { minHeight: "100vh" as unknown as number } : null),
  },
});
