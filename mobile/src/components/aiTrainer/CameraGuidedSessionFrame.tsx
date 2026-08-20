import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraWorkoutShell, type CameraWorkoutShellProps } from "./CameraWorkoutShell";
import { AI_C } from "./aiTrainerTokens";

type CameraGuidedSessionFrameProps = CameraWorkoutShellProps & {
  children?: ReactNode;
};

/**
 * Full-screen camera guided workout chrome — matches AI Camera Session layout.
 * Use this wrapper for every camera entry point except AICameraWorkoutScreen.
 */
export function CameraGuidedSessionFrame({ children, ...shellProps }: CameraGuidedSessionFrameProps) {
  return (
    <SafeAreaView style={styles.safeDark} edges={["top"]}>
      <View style={styles.cameraShell}>
        <CameraWorkoutShell {...shellProps} />
      </View>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeDark: { flex: 1, backgroundColor: AI_C.bg },
  cameraShell: { flex: 1 },
});
