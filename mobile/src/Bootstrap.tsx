import { type ReactNode, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

type BuildConfigStatus = {
  apiUrl: boolean;
  firebase: boolean;
};

function readBuildConfig(): BuildConfigStatus {
  return {
    apiUrl: Boolean((process.env.EXPO_PUBLIC_API_URL ?? "").trim()),
    firebase: Boolean((process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "").trim()),
  };
}

function BuildConfigError({ status }: { status: BuildConfigStatus }) {
  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>NexRep cannot start</Text>
        <Text style={styles.body}>
          This APK was built without required configuration. Ask for a newer preview build from EAS.
        </Text>
        <Text style={styles.row}>API URL: {status.apiUrl ? "OK" : "MISSING"}</Text>
        <Text style={styles.row}>Firebase: {status.firebase ? "OK" : "MISSING"}</Text>
      </ScrollView>
    </View>
  );
}

function RuntimeError({ message }: { message: string }) {
  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>NexRep crashed on startup</Text>
        <Text style={styles.body}>{message}</Text>
      </ScrollView>
    </View>
  );
}

export default function Bootstrap() {
  const [status] = useState(readBuildConfig);
  const [AppComponent, setAppComponent] = useState<(() => ReactNode) | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    if (!status.apiUrl || !status.firebase) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const App = require("../App").default as () => ReactNode;
      setAppComponent(() => App);
    } catch (e) {
      console.error("[Bootstrap] Failed to load App:", e);
      const message = e instanceof Error ? e.message : String(e);
      setRuntimeError(message);
    }
  }, [status.apiUrl, status.firebase]);

  if (!status.apiUrl || !status.firebase) {
    return <BuildConfigError status={status} />;
  }

  if (runtimeError) {
    return <RuntimeError message={runtimeError} />;
  }

  if (!AppComponent) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.body}>Loading…</Text>
      </View>
    );
  }

  return <AppComponent />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 24 },
  title: { fontSize: 20, fontWeight: "700", color: "#111", marginBottom: 12 },
  body: { fontSize: 14, color: "#333", lineHeight: 20, marginBottom: 12 },
  row: { fontSize: 14, color: "#555", marginTop: 4 },
});
