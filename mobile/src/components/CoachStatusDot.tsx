import { StyleSheet, View } from "react-native";
import { useConnectivityStore } from "../store/connectivityStore";

type Props = {
  onlineColor: string;
};

export function CoachStatusDot({ onlineColor }: Props) {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const serverReachable = useConnectivityStore((s) => s.serverReachable);
  const connected = isOnline && serverReachable;

  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: connected ? onlineColor : "#BBBBBB" },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 99 },
});
