/**
 * BodyTypeSelectionModal
 * Opens the 3-step body type selection flow inside a bottom sheet modal.
 * Reuses BodyTypeCard, useBodyTypeImages, BODY_DATA —
 * same as Screen5BodyType but presented as a modal from Screen2Goal.
 */
import React, { useState, useEffect } from "react";
import {
  Modal,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOnboardingContext } from "../hooks/OnboardingContext";
import {
  BODY_DATA,
  BodyGender,
  slotKey,
  GOAL_TYPE_TO_BODY_ID,
} from "../data/bodyTypeData";
import { BodyTypeCard } from "./BodyTypeCard";
import { useBodyTypeImages } from "../hooks/useBodyTypeImages";
import { BodyTypeData } from "../types/onboarding";

const { width: SW, height: SH } = Dimensions.get("window");
const MODAL_PAD = 13; // matches scroll contentContainerStyle padding
const CARD_PAD = 12;  // matches ms.card padding
const CARD_GAP = 6;
const LABEL_H = 22;

// Inner width of the white step card (scroll pad + card pad)
const availW = SW - MODAL_PAD * 2 - CARD_PAD * 2;

// Step 1: 3-column · Step 2: 2-column
const col3W = Math.floor((availW - CARD_GAP * 2) / 3);
const col2W = Math.floor((availW - CARD_GAP) / 2);

// Height budget so 2 rows fit without scrolling (header/toggle/copy/buttons)
const GRID_BUDGET = Math.max(220, SH - 280);
const figH3 = Math.max(
  64,
  Math.min(
    Math.floor((GRID_BUDGET - CARD_GAP) / 2) - LABEL_H,
    Math.round(((col3W - 4) * 150) / 80),
  ),
);
const figW3 = Math.min(col3W - 4, Math.round((figH3 * 80) / 150));
const figH2 = Math.max(
  72,
  Math.min(
    Math.floor((GRID_BUDGET - CARD_GAP - 40) / 2) - LABEL_H,
    Math.round(((col2W - 8) * 150) / 80),
  ),
);
const figW2 = Math.min(col2W - 8, Math.round((figH2 * 80) / 150));
const GREEN = "#0F6E56";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <View style={{ height: 4, backgroundColor: "#F3F4F6", borderRadius: 2, marginBottom: 14 }}>
      <View
        style={{ height: 4, backgroundColor: GREEN, borderRadius: 2, width: `${pct}%` }}
      />
    </View>
  );
}

export function BodyTypeSelectionModal({ visible, onClose }: Props) {
  const { data, updateBodyType } = useOnboardingContext();
  const { getImage } = useBodyTypeImages();

  const rawSex = data.personal.sex ?? "male";
  const initGender: BodyGender = rawSex === "female" ? "female" : "male";

  const goalType = data.goal.type ?? "";
  const initGoalId = GOAL_TYPE_TO_BODY_ID[goalType]?.[initGender] ?? "";

  const saved = data.body_type;

  const [gender, setGender] = useState<BodyGender>(saved?.gender ?? initGender);
  const [step, setStep] = useState(1);
  const [selCurrent, setSelCurrent] = useState<string>(saved?.current_body_id ?? "");
  const [selGoal, setSelGoal] = useState<string>(saved?.goal_body_id ?? initGoalId);
  const [chips, setChips] = useState<string[]>(saved?.problem_areas ?? []);

  useEffect(() => {
    if (visible) {
      const s = data.body_type;
      const g: BodyGender = (s?.gender ?? initGender) as BodyGender;
      setGender(g);
      setSelCurrent(s?.current_body_id ?? "");
      setSelGoal(s?.goal_body_id ?? (GOAL_TYPE_TO_BODY_ID[goalType]?.[g] ?? ""));
      setChips(s?.problem_areas ?? []);
      setStep(1);
    }
  }, [visible, data.body_type, goalType, initGender]);

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

  const handleDone = () => {
    persist(selCurrent, selGoal, gender, chips);
    onClose();
  };

  const handleSkip = () => {
    persist(selCurrent, selGoal, gender, chips);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={ms.root}>
        <View style={ms.header}>
          <Text style={ms.headerTitle}>Body type</Text>
          <TouchableOpacity onPress={onClose} style={ms.closeBtn} hitSlop={12}>
            <Text style={ms.closeTxt}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={ms.scroll} showsVerticalScrollIndicator={false}>
          <View style={ms.toggleRow}>
            <View style={ms.tgWrap}>
              {(["male", "female"] as BodyGender[]).map((g) => (
                <TouchableOpacity
                  key={g}
                  onPress={() => switchGender(g)}
                  style={[ms.tgBtn, gender === g && ms.tgBtnOn]}
                >
                  <Text style={[ms.tgTxt, gender === g && ms.tgTxtOn]}>
                    {g === "male" ? "Male" : "Female"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {step === 1 && (
            <View style={ms.card}>
              <Text style={ms.stepLbl}>STEP 1 OF 3 · BODY TYPE</Text>
              <ProgressBar pct={33} />
              <Text style={ms.h3}>What's your current body type?</Text>
              <Text style={ms.sub}>Pick the one closest to you today — no judgment.</Text>
              <View style={ms.grid3}>
                {bodyData.current.map((item) => (
                  <View key={item.id} style={{ width: col3W }}>
                    <BodyTypeCard
                      item={item}
                      gender={gender}
                      category="current"
                      selected={selCurrent === item.id}
                      onPress={() => setSelCurrent(item.id)}
                      customImageUrl={getImage(slotKey(gender, "current", item.id))}
                      figureWidth={figW3}
                      figureHeight={figH3}
                    />
                  </View>
                ))}
              </View>
              {selCurrent ? (
                <TouchableOpacity style={ms.btnMain} onPress={() => setStep(2)}>
                  <Text style={ms.btnMainTxt}>Continue →</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {step === 2 && (
            <View style={ms.card}>
              <Text style={ms.stepLbl}>STEP 2 OF 3 · BODY TYPE</Text>
              <ProgressBar pct={66} />
              <Text style={ms.h3}>Where do you want to be?</Text>
              <Text style={ms.sub}>
                Based on your goal we've made a suggestion — feel free to change it.
              </Text>
              <View style={ms.grid2}>
                {bodyData.goal.map((item) => (
                  <View key={item.id} style={{ width: col2W }}>
                    <BodyTypeCard
                      item={item}
                      gender={gender}
                      category="goal"
                      selected={selGoal === item.id}
                      onPress={() => setSelGoal(item.id)}
                      customImageUrl={getImage(slotKey(gender, "goal", item.id))}
                      figureWidth={figW2}
                      figureHeight={figH2}
                    />
                  </View>
                ))}
              </View>
              {selCurrent && selGoal ? (
                <View style={ms.journey}>
                  <Text style={ms.jFrom}>{curLabel}</Text>
                  <Text style={ms.jArrow}>→</Text>
                  <Text style={ms.jTo}>{goalLabel}</Text>
                </View>
              ) : null}
              {selGoal ? (
                <TouchableOpacity style={ms.btnMain} onPress={() => setStep(3)}>
                  <Text style={ms.btnMainTxt}>Continue →</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={ms.btnBack} onPress={() => setStep(1)}>
                <Text style={ms.btnBackTxt}>← Back</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 3 && (
            <View style={ms.card}>
              <Text style={ms.stepLbl}>STEP 3 OF 3 · BODY TYPE</Text>
              <ProgressBar pct={100} />
              <Text style={ms.h3}>Any problem areas to fix?</Text>
              <Text style={ms.sub}>
                Select all that apply — your AI workout and meal plans will specifically target these.
              </Text>
              <View style={ms.chipsWrap}>
                {bodyData.chips.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => toggleChip(c)}
                    style={[ms.chip, chips.includes(c) && ms.chipOn]}
                  >
                    <Text style={[ms.chipTxt, chips.includes(c) && ms.chipTxtOn]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={ms.summary}>
                <Text style={ms.summaryTitle}>YOUR TRANSFORMATION</Text>
                <View style={ms.journey}>
                  <Text style={ms.jFrom}>{curLabel}</Text>
                  <Text style={ms.jArrow}>→</Text>
                  <Text style={ms.jTo}>{goalLabel}</Text>
                </View>
                {chips.length > 0 ? (
                  <Text style={ms.summaryAreas}>
                    Target areas: <Text style={{ fontWeight: "700" }}>{chips.join(", ")}</Text>
                  </Text>
                ) : null}
              </View>

              <TouchableOpacity style={ms.btnMain} onPress={handleDone}>
                <Text style={ms.btnMainTxt}>Done ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ms.btnBack} onPress={() => setStep(2)}>
                <Text style={ms.btnBackTxt}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSkip}>
                <Text style={ms.skipTxt}>Skip — I have no problem areas</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const ms = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F9FAFB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  closeBtn: { padding: 4 },
  closeTxt: { fontSize: 16, color: "#6B7280", fontWeight: "600" },
  scroll: { padding: 13, paddingBottom: 50 },
  toggleRow: { alignItems: "center", marginBottom: 14 },
  tgWrap: { flexDirection: "row", backgroundColor: "#F3F4F6", borderRadius: 999, padding: 3, gap: 3 },
  tgBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999 },
  tgBtnOn: { backgroundColor: GREEN },
  tgTxt: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  tgTxtOn: { color: "#fff" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: CARD_PAD,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  stepLbl: { fontSize: 10, color: "#9CA3AF", fontWeight: "700", letterSpacing: 0.8, marginBottom: 2 },
  h3: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 2 },
  sub: { fontSize: 12, color: "#6B7280", lineHeight: 17, marginBottom: 10 },
  grid3: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP, justifyContent: "flex-start" },
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP, justifyContent: "flex-start" },
  btnMain: { backgroundColor: GREEN, borderRadius: 999, paddingVertical: 12, alignItems: "center", marginTop: 10 },
  btnMainTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  btnBack: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 6,
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
  jArrow: { fontSize: 20, color: GREEN, fontWeight: "800" },
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
  chipOn: { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt: { fontSize: 12, color: "#374151", fontWeight: "500" },
  chipTxtOn: { color: "#fff" },
  summary: { backgroundColor: "#F0FDF9", borderRadius: 8, padding: 12, marginTop: 12 },
  summaryTitle: { fontSize: 10, color: "#9CA3AF", fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
  summaryAreas: { fontSize: 11, color: "#6B7280", marginTop: 6 },
});
