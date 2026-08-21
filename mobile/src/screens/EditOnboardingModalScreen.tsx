import { useNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BlurredModalScreenShell } from "../components/BlurredModalScreenShell";
import { EditOnboardingModalContext } from "../hooks/useEditOnboardingModal";
import { OnboardingProvider } from "../hooks/OnboardingContext";
import Screen1Personal from "./onboarding/Screen1Personal";
import Screen2Goal from "./onboarding/Screen2Goal";
import Screen3Activity from "./onboarding/Screen3Activity";
import Screen4Diet from "./onboarding/Screen4Diet";
import Screen5BodyComp from "./onboarding/Screen5BodyComp";
import Screen6Setup from "./onboarding/Screen6Setup";
import ResultsScreen from "./onboarding/ResultsScreen";
import type { OnboardingStackParamList } from "../navigation/types";

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export default function EditOnboardingModalScreen() {
  const navigation = useNavigation();

  return (
    <EditOnboardingModalContext.Provider value>
      <BlurredModalScreenShell onClose={() => navigation.goBack()} variant="center">
        <OnboardingProvider>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
            <Stack.Screen name="Screen1Personal" component={Screen1Personal} />
            <Stack.Screen name="Screen2Goal" component={Screen2Goal} />
            <Stack.Screen name="Screen3Activity" component={Screen3Activity} />
            <Stack.Screen name="Screen4Diet" component={Screen4Diet} />
            <Stack.Screen name="Screen5BodyComp" component={Screen5BodyComp} />
            <Stack.Screen name="Screen6Setup" component={Screen6Setup} />
            <Stack.Screen name="Results" component={ResultsScreen} />
          </Stack.Navigator>
        </OnboardingProvider>
      </BlurredModalScreenShell>
    </EditOnboardingModalContext.Provider>
  );
}
