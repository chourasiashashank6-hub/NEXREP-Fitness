import { Platform } from "react-native";
import { registerRootComponent } from "expo";

if (Platform.OS !== "web") {
  require("react-native-gesture-handler");
  require("react-native-reanimated");
}

import Bootstrap from "./src/Bootstrap";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Bootstrap);
