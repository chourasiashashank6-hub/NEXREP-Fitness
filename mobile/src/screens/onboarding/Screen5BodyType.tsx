import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Dimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { BODY_DATA, BodyGender, slotKey, GOAL_TYPE_TO_BODY_ID } from "../../data/bodyTypeData";
import { BodyTypeCard } from "../../components/BodyTypeCard";
import { useBodyTypeImages } from "../../hooks/useBodyTypeImages";
import { BodyTypeData } from "../../types/onboarding";

const { width: SW } = Dimensions.get("window");
const GAP = 8;
const PAD = 26;
const cardW3 = Math.floor((SW - PAD - GAP * 2) / 3);
const cardW2 = Math.floor((SW - PAD - GAP) / 2);

function ProgressBar({ pct }: { pct: number }) {
  return (
    <View style={{ height: 4, backgroundColor: "#F3F4F6", borderRadius: 2, marginBottom: 14 }}>
      <View style={{ height: 4, backgroundColor: "#0F6E56", borderRadius: 2, width: `${pct}%` }} />
    </View>
  );
}

export default function Screen5BodyType() {
  const navigation = useNavigation<any>();
  const { data, updateBodyType } = useOnboardingContext();
  const { getImage } = useBodyTypeImages();

  const rawSex = data.personal.sex ?? "male";
  const initGender: BodyGender = rawSex === "female" ? "female" : "male";

  const goalType = data.goal.type ?? "";
  const initGoalId = GOAL_TYPE_TO_BODY_ID[goalType]?.[initGender] ?? "";

  const savedBodyType = data.body_type;

  const [gender, setGender] = useState<BodyGender>(savedBodyType?.gender ?? initGender);
  const [step, setStep] = useState(1);
  const [selCurrent, setSelCurrent] = useState<string>(savedBodyType?.current_body_id ?? "");
  const [selGoal, setSelGoal] = useState<string>(savedBodyType?.goal_body_id ?? initGoalId);
  const [chips, setChips] = useState<string[]>(savedBodyType?.problem_areas ?? []);

  const bodyData = BODY_DATA[gender];

  const switchGender = (g: BodyGender) => {
    setGender(g);
    setSelCurrent("");
    setSelGoal(GOAL_TYPE_TO_BODY_ID[goalType]?.[g] ?? "");
    setChips([]);
    setStep(1);
  };

  const toggleChip = (c: string) =>
    setChips((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  const curLabel = bodyData.current.find((x) => x.id === selCurrent)?.label ?? "";
  const goalLabel = bodyData.goal.find((x) => x.id === selGoal)?.label ?? "";

  const persist = (cur: string, goal: string, g: BodyGender, ch: string[]) => {
    const payload: BodyTypeData = {
      gender: g,
      current_body_id: cur,
      goal_body_id: goal,
      problem_areas: ch,
    };
    updateBodyType(payload);
  };

  useEffect(() => {
    if (selCurrent || selGoal || chips.length) {
      persist(selCurrent, selGoal, gender, chips);
    }
  }, [selCurrent, selGoal, gender, chips]);

  const handleContinue = () => {
    persist(selCurrent, selGoal, gender, chips);
    navigation.navigate("Screen5BodyComp");
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.toggleRow}>
          <View style={s.tgWrap}>
            {(["male", "female"] as BodyGender[]).map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => switchGender(g)}
                style={[s.tgBtn, gender === g && s.tgBtnOn]}
              >
                <Text style={[s.tgTxt, gender === g && s.tgTxtOn]}>
                  {g === "male" ? "Male" : "Female"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {step === 1 && (
          <View style={s.card}>
            <Text style={s.stepLbl}>STEP 1 OF 3 · BODY TYPE</Text>
            <ProgressBar pct={33} />
            <Text style={s.h3}>What's your current body type?</Text>
            <Text style={s.sub}>Pick the one closest to you today — no judgment.</Text>
            <View style={s.grid3}>
              {bodyData.current.map((item) => (
                <BodyTypeCard
                  key={item.id}
                  item={item}
                  gender={gender}
                  category="current"
                  selected={selCurrent === item.id}
                  onPress={() => setSelCurrent(item.id)}
                  customImageUrl={getImage(slotKey(gender, "current", item.id))}
                  figureWidth={cardW3 - 12}
                />
              ))}
            </View>
            {selCurrent ? (
              <TouchableOpacity style={s.btnMain} onPress={() => setStep(2)}>
                <Text style={s.btnMainTxt}>Continue →</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={s.btnBack} onPress={() => navigation.goBack()}>
              <Text style={s.btnBackTxt}>← Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 2 && (
          <View style={s.card}>
            <Text style={s.stepLbl}>STEP 2 OF 3 · BODY TYPE</Text>
            <ProgressBar pct={66} />
            <Text style={s.h3}>Where do you want to be?</Text>
            <Text style={s.sub}>
              Based on your goal we've made a suggestion — feel free to change it.
            </Text>
            <View style={s.grid2}>
              {bodyData.goal.map((item) => (
                <BodyTypeCard
                  key={item.id}
                  item={item}
                  gender={gender}
                  category="goal"
                  selected={selGoal === item.id}
                  onPress={() => setSelGoal(item.id)}
                  customImageUrl={getImage(slotKey(gender, "goal", item.id))}
                  figureWidth={cardW2 - 16}
                />
              ))}
            </View>
            {selCurrent && selGoal ? (
              <View style={s.journey}>
                <Text style={s.jFrom}>{curLabel}</Text>
                <Text style={s.jArrow}>→</Text>
                <Text style={s.jTo}>{goalLabel}</Text>
              </View>
            ) : null}
            {selGoal ? (
              <TouchableOpacity style={s.btnMain} onPress={() => setStep(3)}>
                <Text style={s.btnMainTxt}>Continue →</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={s.btnBack} onPress={() => setStep(1)}>
              <Text style={s.btnBackTxt}>← Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 3 && (
          <View style={s.card}>
            <Text style={s.stepLbl}>STEP 3 OF 3 · BODY TYPE</Text>
            <ProgressBar pct={100} />
            <Text style={s.h3}>Any problem areas to fix?</Text>
            <Text style={s.sub}>
              Select all that apply — your AI workout and meal plans will specifically target these.
            </Text>
            <View style={s.chipsWrap}>
              {bodyData.chips.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => toggleChip(c)}
                  style={[s.chip, chips.includes(c) && s.chipOn]}
                >
                  <Text style={[s.chipTxt, chips.includes(c) && s.chipTxtOn]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.summary}>
              <Text style={s.summaryTitle}>YOUR TRANSFORMATION</Text>
              <View style={s.journey}>
                <Text style={s.jFrom}>{curLabel}</Text>
                <Text style={s.jArrow}>→</Text>
                <Text style={s.jTo}>{goalLabel}</Text>
              </View>
              {chips.length > 0 ? (
                <Text style={s.summaryAreas}>
                  Target areas: <Text style={{ fontWeight: "700" }}>{chips.join(", ")}</Text>
                </Text>
              ) : null}
            </View>
            <TouchableOpacity style={s.btnMain} onPress={handleContinue}>
              <Text style={s.btnMainTxt}>Continue →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnBack} onPress={() => setStep(2)}>
              <Text style={s.btnBackTxt}>← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleContinue}>
              <Text style={s.skipTxt}>Skip — I have no problem areas</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const G = "#0F6E56";
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFB" },
  scroll: { padding: 13, paddingBottom: 40 },
  toggleRow: { alignItems: "center", marginBottom: 14 },
  tgWrap: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    padding: 3,
    gap: 3,
  },
  tgBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999 },
  tgBtnOn: { backgroundColor: G },
  tgTxt: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  tgTxtOn: { color: "#fff" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  stepLbl: {
    fontSize: 10,
    color: "#9CA3AF",
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  h3: { fontSize: 17, fontWeight: "700", color: "#111827", marginBottom: 3 },
  sub: { fontSize: 13, color: "#6B7280", lineHeight: 20, marginBottom: 13 },
  grid3: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btnMain: {
    backgroundColor: G,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 14,
  },
  btnMainTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  btnBack: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
    backgroundColor: "#fff",
  },
  btnBackTxt: { color: "#6B7280", fontSize: 14 },
  skipTxt: { textAlign: "center", fontSize: 12, color: "#9CA3AF", marginTop: 10 },
  journey: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#F0FDF9",
    borderRadius: 8,
    padding: 11,
    marginTop: 10,
  },
  jFrom: { fontSize: 13, color: "#6B7280" },
  jArrow: { fontSize: 20, color: G, fontWeight: "800" },
  jTo: { fontSize: 13, fontWeight: "700", color: "#085041" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  chipOn: { backgroundColor: G, borderColor: G },
  chipTxt: { fontSize: 12, color: "#374151", fontWeight: "500" },
  chipTxtOn: { color: "#fff" },
  summary: { backgroundColor: "#F0FDF9", borderRadius: 8, padding: 12, marginTop: 12 },
  summaryTitle: {
    fontSize: 10,
    color: "#9CA3AF",
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  summaryAreas: { fontSize: 11, color: "#6B7280", marginTop: 6 },
});
