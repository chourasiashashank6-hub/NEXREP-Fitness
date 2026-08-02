export type UserProfile = {
  id: string;
  name: string;
  email: string;
  age: number;
  weight: number;
  goals: string;
  goalTag: string;
  difficulty: string;
  disciplineScore: number;
};

export type Summary = {
  caloriesConsumed: number;
  caloriesBurned: number;
  workoutSummary: string;
  disciplineScore: number;
};

export type Workout = {
  id: string;
  type: "stability" | "hiit" | "compound";
  exerciseName: string;
  sets?: number;
  reps?: number;
  duration?: number;
  notes?: string;
  date: string;
};

export type Meal = {
  id: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date: string;
};
