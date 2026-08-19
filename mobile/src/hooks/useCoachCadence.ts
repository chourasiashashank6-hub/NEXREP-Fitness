import { useCallback, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFeatureAccess } from "./useFeatureAccess";
import { CADENCE_FEATURE, type CoachCadence } from "./useCoachRedesign";
import type { CoachStackParamList } from "../navigation/coachTypes";

export function useCoachCadence() {
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { hasFeatureAccess } = useFeatureAccess();
  const [cadence, setCadence] = useState<CoachCadence>("daily");

  const isCadenceLocked = useCallback(
    (value: CoachCadence) => !hasFeatureAccess(CADENCE_FEATURE[value]),
    [hasFeatureAccess],
  );

  const handleYearlyPress = useCallback(() => {
    if (isCadenceLocked("yearly")) {
      setCadence("yearly");
      return;
    }
    navigation.navigate("YearlyReview");
  }, [isCadenceLocked, navigation]);

  return {
    cadence,
    setCadence,
    isCadenceLocked,
    handleYearlyPress,
  };
}
