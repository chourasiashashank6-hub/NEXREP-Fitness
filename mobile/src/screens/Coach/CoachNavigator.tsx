import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import CoachHomeScreen from "./CoachHomeScreen";
import AICalorieCoachScreen from "./AICalorieCoachScreen";
import AIWorkoutCoachScreen from "./AIWorkoutCoachScreen";
import YearlyReviewScreen from "./YearlyReviewScreen";
import MonthlyMealPlannerScreen from "./MonthlyMealPlannerScreen";
import MonthlyWorkoutPlannerScreen from "./MonthlyWorkoutPlannerScreen";

const Stack = createNativeStackNavigator<CoachStackParamList>();

export default function CoachNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CoachHome" component={CoachHomeScreen} />
      <Stack.Screen name="AICalorieCoach" component={AICalorieCoachScreen} />
      <Stack.Screen name="AIWorkoutCoach" component={AIWorkoutCoachScreen} />
      <Stack.Screen name="YearlyReview" component={YearlyReviewScreen} />
      <Stack.Screen name="MonthlyMealPlanner" component={MonthlyMealPlannerScreen} />
      <Stack.Screen name="MonthlyWorkoutPlanner" component={MonthlyWorkoutPlannerScreen} />
    </Stack.Navigator>
  );
}
