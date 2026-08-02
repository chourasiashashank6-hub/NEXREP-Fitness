import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { DynamicCoachingTipIcon } from "../types/workoutCoach";

type IconConfig = {
  library: "Ionicons" | "MaterialCommunityIcons";
  name: keyof typeof Ionicons.glyphMap | keyof typeof MaterialCommunityIcons.glyphMap | string;
  color: string;
};

const COACHING_ICON_MAP: Record<DynamicCoachingTipIcon, IconConfig> = {
  lightning: { library: "Ionicons", name: "flash", color: "#FBBF24" },
  repeat: { library: "Ionicons", name: "repeat", color: "#34D399" },
  droplet: { library: "Ionicons", name: "water", color: "#60A5FA" },
  moon: { library: "Ionicons", name: "moon", color: "#A78BFA" },
  target: { library: "Ionicons", name: "radio-button-on", color: "#F87171" },
  fire: { library: "Ionicons", name: "flame", color: "#FB923C" },
  clock: { library: "Ionicons", name: "time", color: "#94A3B8" },
  shield: { library: "Ionicons", name: "shield-checkmark", color: "#34D399" },
  chart: { library: "Ionicons", name: "bar-chart", color: "#38BDF8" },
  dumbbell: { library: "MaterialCommunityIcons", name: "dumbbell", color: "#E2E8F0" },
};

export function CoachingIcon({ iconName, size = 20 }: { iconName: string; size?: number }) {
  const config = COACHING_ICON_MAP[iconName as DynamicCoachingTipIcon] ?? COACHING_ICON_MAP.lightning;
  if (config.library === "MaterialCommunityIcons") {
    return <MaterialCommunityIcons name={config.name as keyof typeof MaterialCommunityIcons.glyphMap} size={size} color={config.color} />;
  }
  return <Ionicons name={config.name as keyof typeof Ionicons.glyphMap} size={size} color={config.color} />;
}
