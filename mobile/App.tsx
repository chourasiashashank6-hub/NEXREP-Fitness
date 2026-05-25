import { Component, type ErrorInfo, type ReactNode } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { AppThemeProvider } from "./src/theme";

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
            <Text style={errorStyles.title}>Something went wrong</Text>
            <Text style={errorStyles.message}>{this.state.error.message}</Text>
            <Text style={errorStyles.hint}>Try a hard refresh (Cmd+Shift+R). If it persists, clear site data for localhost.</Text>
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

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AppThemeProvider>
          <NavigationContainer>
            <StatusBar style="dark" />
            <RootNavigator />
          </NavigationContainer>
        </AppThemeProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
