import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useWorkoutSessionStore } from "../store/workoutSessionStore";
import { GREEN, TEXT } from "../theme/colors";

const AMBER = "#BA7517";
const MUTED = "#6B7280";

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h >= 1) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export default function WorkoutCompletionScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "WorkoutCompletion">>();
  const clearSession = useWorkoutSessionStore((s) => s.clearSession);
  const params = route.params;

  const [displayKcal, setDisplayKcal] = useState(params?.clientKcal ?? 0);
  const [syncing, setSyncing] = useState(params?.serverKcal == null);

  useEffect(() => {
    if (params?.serverKcal != null) {
      setDisplayKcal(params.serverKcal);
      setSyncing(false);
    }
  }, [params?.serverKcal]);

  const onDone = () => {
    clearSession();
    navigation.navigate("Main", { screen: "Home" });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.check}>✅</Text>
        <Text style={styles.title}>Workout complete!</Text>

        <View style={styles.stat}>
          <Text style={styles.statLbl}>Total time</Text>
          <Text style={styles.statVal}>{formatElapsed(params?.elapsedSec ?? 0)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLbl}>Calories</Text>
          <View style={styles.kcalRow}>
            <Text style={[styles.statVal, { color: AMBER }]}>{Math.round(displayKcal)} kcal</Text>
            {syncing ? <ActivityIndicator size="small" color={AMBER} /> : null}
          </View>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLbl}>Volume</Text>
          <Text style={styles.statVal}>{Math.round(params?.volumeKg ?? 0)} kg</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLbl}>Sets completed</Text>
          <Text style={styles.statVal}>{params?.setsCompleted ?? 0}</Text>
        </View>

        {params?.streakIncremented ? (
          <View style={styles.streakBadge}>
            <Text style={styles.streakTxt}>🔥 Streak +1</Text>
          </View>
        ) : null}

        <Pressable style={styles.doneBtn} onPress={onDone}>
          <Text style={styles.doneTxt}>Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff", justifyContent: "center", padding: 20 },
  card: { alignItems: "center" },
  check: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: TEXT, marginBottom: 24 },
  stat: { width: "100%", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  statLbl: { color: MUTED, fontSize: 14, fontWeight: "600" },
  statVal: { color: TEXT, fontSize: 16, fontWeight: "800" },
  kcalRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  streakBadge: {
    marginTop: 12,
    backgroundColor: "#FAEEDA",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  streakTxt: { color: AMBER, fontWeight: "800", fontSize: 15 },
  doneBtn: {
    marginTop: 28,
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignSelf: "stretch",
    alignItems: "center",
  },
  doneTxt: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
