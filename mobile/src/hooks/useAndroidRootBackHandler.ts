import { useCallback, useRef } from "react";
import { BackHandler, Platform, ToastAndroid } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { shouldIgnoreRapidBackPress } from "../utils/hardwareBackDebounce";

type MainTabParamList = {
  Home: undefined;
  Workout: undefined;
  Calories: undefined;
  Coach: undefined;
  Social: undefined;
  Profile: undefined;
};

/**
 * Android root-tab back: nested stacks pop normally; tab roots go to Home;
 * double-press on Home exits the app.
 */
export function useAndroidRootBackHandler() {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const lastHomeExitPress = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;

      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (shouldIgnoreRapidBackPress()) return true;

        const tabState = navigation.getState();
        const currentTab = tabState.routes[tabState.index];
        const nested = currentTab.state;

        if (nested && typeof nested.index === "number" && nested.index > 0) {
          return false;
        }

        if (currentTab.name !== "Home") {
          navigation.navigate("Home");
          return true;
        }

        const now = Date.now();
        if (now - lastHomeExitPress.current < 2000) {
          BackHandler.exitApp();
          return true;
        }
        lastHomeExitPress.current = now;
        ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
        return true;
      });

      return () => sub.remove();
    }, [navigation]),
  );
}
