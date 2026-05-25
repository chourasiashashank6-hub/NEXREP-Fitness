import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { chatWithCoach } from "../api/ai";
import { AppButton } from "../components/AppButton";
import { AppCard } from "../components/AppCard";
import { AppInput } from "../components/AppInput";
import { HeroHeader } from "../components/HeroHeader";
import { ScreenContainer } from "../components/ScreenContainer";
import { useAppTheme } from "../theme";

type Message = { id: string; role: "user" | "assistant"; content: string };

export const ChatScreen = () => {
  const { colors } = useAppTheme();
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const send = async () => {
    if (!text.trim()) return;
    const userMsg: Message = { id: `${Date.now()}-${Math.random()}`, role: "user", content: text };
    setMessages((prev) => [userMsg, ...prev]);
    setText("");

    try {
      const data = await chatWithCoach({ message: userMsg.content });
      const botMsg: Message = { id: `${Date.now()}-${Math.random()}`, role: "assistant", content: data.reply };
      setMessages((prev) => [botMsg, ...prev]);
    } catch {
      Alert.alert("Error", "Coach is unavailable right now.");
    }
  };

  return (
    <ScreenContainer>
      <HeroHeader title="AI Coach" subtitle="Ask for workouts, recovery tips, and discipline advice" />
      <FlatList
        style={styles.list}
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.muted }]}>Try: "Suggest today's workout"</Text>}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user"
                ? [styles.userBubble, { backgroundColor: colors.primary }]
                : [styles.botBubble, { borderColor: colors.border, backgroundColor: colors.cardAlt }],
            ]}
          >
            <Text style={item.role === "user" ? styles.userText : [styles.botText, { color: colors.text }]}>{item.content}</Text>
          </View>
        )}
      />
      <AppCard>
        <AppInput label="Message" placeholder="Ask your coach..." value={text} onChangeText={setText} />
        <AppButton label="Send" onPress={send} />
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  list: { maxHeight: 360, marginBottom: 12 },
  empty: { textAlign: "center", marginTop: 12 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 8, maxWidth: "90%" },
  userBubble: { alignSelf: "flex-end" },
  botBubble: { alignSelf: "flex-start", borderWidth: 1 },
  userText: { color: "#02050A" },
  botText: {},
});
