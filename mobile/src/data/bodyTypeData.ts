export interface BodyParams {
  sh: number;
  ar: number;
  ch: number;
  wa: number;
  hi: number;
  th: number;
}

export interface BodyTypeItem {
  id: string;
  label: string;
  params: BodyParams;
}

export type BodyGender = "male" | "female";
export type SlotCategory = "current" | "goal";

export const slotKey = (g: BodyGender, cat: SlotCategory, id: string) => `${g}_${cat}_${id}`;

export const GOAL_TYPE_TO_BODY_ID: Record<string, { male: string; female: string }> = {
  fat_loss: { male: "ln", female: "to" },
  muscle_gain: { male: "mu", female: "at" },
  strength: { male: "bk", female: "sc" },
  recomp: { male: "at", female: "at" },
  maintain: { male: "at", female: "to" },
};

export const BODY_DATA: Record<
  BodyGender,
  { current: BodyTypeItem[]; goal: BodyTypeItem[]; chips: string[] }
> = {
  male: {
    current: [
      { id: "sk", label: "Skinny", params: { sh: 13, ar: 3, ch: 11, wa: 9, hi: 10, th: 9 } },
      { id: "sf", label: "Skinny fat", params: { sh: 15, ar: 4, ch: 14, wa: 15, hi: 14, th: 12 } },
      { id: "av", label: "Average", params: { sh: 17, ar: 5, ch: 15, wa: 13, hi: 14, th: 12 } },
      { id: "ow", label: "Overweight", params: { sh: 18, ar: 7, ch: 18, wa: 21, hi: 19, th: 17 } },
      { id: "ob", label: "Obese", params: { sh: 19, ar: 10, ch: 21, wa: 27, hi: 24, th: 21 } },
      { id: "mu", label: "Muscular", params: { sh: 22, ar: 7, ch: 19, wa: 13, hi: 16, th: 17 } },
    ],
    goal: [
      { id: "ln", label: "Lean & cut", params: { sh: 19, ar: 5, ch: 17, wa: 11, hi: 13, th: 13 } },
      { id: "at", label: "Athletic", params: { sh: 20, ar: 6, ch: 18, wa: 13, hi: 15, th: 14 } },
      { id: "mu", label: "Muscular", params: { sh: 23, ar: 7, ch: 20, wa: 14, hi: 16, th: 17 } },
      { id: "bk", label: "Bulk & strong", params: { sh: 22, ar: 8, ch: 21, wa: 17, hi: 18, th: 18 } },
    ],
    chips: [
      "Chest fat / man boobs",
      "Belly fat",
      "Love handles",
      "Skinny arms",
      "Rounded shoulders",
      "Double chin",
      "Chicken legs",
      "Back fat",
      "Weak core",
    ],
  },
  female: {
    current: [
      { id: "sk", label: "Skinny", params: { sh: 12, ar: 2, ch: 10, wa: 8, hi: 14, th: 10 } },
      { id: "sf", label: "Skinny fat", params: { sh: 13, ar: 3, ch: 12, wa: 13, hi: 18, th: 13 } },
      { id: "av", label: "Average", params: { sh: 15, ar: 4, ch: 13, wa: 12, hi: 19, th: 13 } },
      { id: "cv", label: "Curvy", params: { sh: 15, ar: 4, ch: 14, wa: 12, hi: 23, th: 16 } },
      { id: "ow", label: "Overweight", params: { sh: 17, ar: 6, ch: 16, wa: 19, hi: 22, th: 17 } },
      { id: "ob", label: "Obese", params: { sh: 18, ar: 9, ch: 19, wa: 25, hi: 26, th: 21 } },
    ],
    goal: [
      { id: "to", label: "Toned", params: { sh: 15, ar: 3, ch: 13, wa: 10, hi: 18, th: 12 } },
      { id: "ln", label: "Lean", params: { sh: 14, ar: 3, ch: 12, wa: 9, hi: 15, th: 11 } },
      { id: "at", label: "Fit & athletic", params: { sh: 17, ar: 5, ch: 15, wa: 12, hi: 20, th: 14 } },
      { id: "sc", label: "Strong & curvy", params: { sh: 17, ar: 5, ch: 15, wa: 13, hi: 23, th: 16 } },
    ],
    chips: [
      "Belly pooch",
      "Love handles / muffin top",
      "Arm flab (bat wings)",
      "Inner thigh fat",
      "Bra / back fat",
      "Flat glutes",
      "Double chin",
      "Hunched posture",
      "Weak core / postpartum",
    ],
  },
};
