// AI support assistant chat (backend offline-FAQ fallback or live AI).
import { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

type Msg = { id: string; from: "user" | "bot"; text: string };

const SUGGESTIONS = ["What is my wallet balance?", "How do I become a driver?", "How much does a ride cost?", "My recent ride status"];

export default function AssistantScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([
    { id: "w", from: "bot", text: "Hi! I'm the Naija Ride assistant. Ask me about your wallet, rides, pricing, driving, or promo codes." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = useCallback(async (body: string) => {
    const text = body.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, from: "user", text }]);
    setSending(true);
    try {
      const res = await api.assistant(text);
      setMessages((m) => [...m, { id: `b${Date.now()}`, from: "bot", text: res.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, from: "bot", text: `Sorry — ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  }, [sending]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} testID="assistant-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Ionicons name="sparkles" size={18} color={colors.primary} />
          <Text style={styles.title}>Support assistant</Text>
        </View>
        <View style={styles.spacer} />
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.from === "user" ? styles.userBubble : styles.botBubble]}>
            <Text style={[styles.bubbleText, item.from === "user" && styles.userText]}>{item.text}</Text>
          </View>
        )}
        ListFooterComponent={
          sending ? (
            <View style={styles.typing}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.typingText}>Thinking…</Text>
            </View>
          ) : messages.length === 1 ? (
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity key={s} style={styles.chip} onPress={() => send(s)} testID={`suggest-${s.split(" ")[0]}`}>
                  <Text style={styles.chipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything…"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="send"
            onSubmitEditing={() => send(input)}
            testID="assistant-input"
          />
          <TouchableOpacity style={styles.send} onPress={() => send(input)} disabled={sending} testID="assistant-send">
            <Ionicons name="arrow-up" size={22} color={colors.textInverse} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  titleWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  spacer: { width: 26 },
  list: { padding: spacing.md, gap: spacing.sm },
  bubble: { maxWidth: "82%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.primary },
  botBubble: { alignSelf: "flex-start", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  bubbleText: { fontSize: 15, lineHeight: 21, color: colors.textPrimary },
  userText: { color: colors.textInverse },
  typing: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  typingText: { color: colors.textSecondary, fontSize: 14 },
  suggestions: { gap: spacing.sm, marginTop: spacing.md },
  chip: { alignSelf: "flex-start", backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill },
  chipText: { color: colors.primaryDark, fontSize: 14, fontWeight: "600" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.input, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.textPrimary, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
