// Job chat: customer <-> provider live messaging with WebSocket delivery + call.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/lib/auth";
import { api, chatWsUrl, type ChatMessage } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

type EntityType = "ride" | "delivery" | "moving";

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ entity?: string; entity_id?: string; title?: string }>();
  const entity = (params.entity ?? "ride") as EntityType;
  const entityId = params.entity_id ?? "";
  const title = params.title ?? "Job chat";
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const loadMessages = useCallback(async () => {
    try {
      if (entity === "delivery") setMessages(await api.deliveryMessages(entityId));
      else if (entity === "moving") setMessages(await api.movingMessages(entityId));
      else setMessages(await api.chatMessages(entityId));
    } catch {
      setMessages([]);
    }
  }, [entity, entityId]);

  const send = useCallback(async (body: string) => {
    if (entity === "delivery") return api.sendDeliveryMessage(entityId, body);
    if (entity === "moving") return api.sendMovingMessage(entityId, body);
    return api.sendChatMessage(entityId, body);
  }, [entity, entityId]);

  const appendUnique = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      if (!prev) return [incoming];
      if (prev.some((m) => m.message_id === incoming.message_id)) return prev;
      return [...prev, incoming];
    });
  }, []);

  useEffect(() => {
    if (!entityId) return;
    loadMessages();
    let ws: WebSocket | null = null;
    (async () => {
      try {
        ws = new WebSocket(await chatWsUrl());
        wsRef.current = ws;
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as { event: string; message?: ChatMessage };
            if (data.event !== "chat.message" || !data.message) return;
            const inScope =
              (entity === "ride" && data.message.ride_id === entityId) ||
              (entity === "delivery" && data.message.delivery_id === entityId) ||
              (entity === "moving" && data.message.moving_id === entityId);
            if (inScope) appendUnique(data.message);
          } catch {}
        };
      } catch {}
    })();
    return () => {
      ws?.close();
      wsRef.current = null;
    };
  }, [entity, entityId, loadMessages, appendUnique]);

  const onSend = useCallback(async () => {
    const body = input.trim();
    if (!body || sending || !entityId) return;
    setSending(true);
    try {
      const sent = await send(body);
      setInput("");
      appendUnique(sent);
    } catch {
      setInput(body);
    } finally {
      setSending(false);
    }
  }, [input, sending, entityId, send, appendUnique]);

  const call = useCallback(async () => {
    if (!entityId) return;
    try {
      const contact = await api.chatContact(entity, entityId);
      if (!contact.phone) {
        Alert.alert("No number", "No phone number is available for this person yet.");
        return;
      }
      Linking.openURL(`tel:${contact.phone}`).catch(() => Alert.alert("Call failed", "Could not open the dialer."));
    } catch {
      Alert.alert("Not available", "Calling is not available for this job yet.");
    }
  }, [entity, entityId]);

  const myId = user?.user_id;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="chat-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerAvatar}><Ionicons name="chatbubble-ellipses" size={16} color="#fff" /></View>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <TouchableOpacity onPress={call} hitSlop={10} testID="chat-call">
          <Ionicons name="call" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {messages === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={40} color={colors.border} />
          <Text style={styles.emptyText}>No messages yet. Say hello to your {entity === "delivery" ? "courier" : entity === "moving" ? "mover" : "driver"}.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.message_id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const mine = item.sender_id === myId;
            return (
              <View style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]} testID={`chat-msg-${item.message_id}`}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                </View>
                <Text style={styles.bubbleTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
            );
          }}
        />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message…"
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={1000}
            testID="chat-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
            onPress={onSend}
            disabled={!input.trim() || sending}
            testID="chat-send"
          >
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  headerAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 60 },
  emptyText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 12 },
  bubbleWrap: { alignItems: "flex-start" },
  bubbleWrapMine: { alignItems: "flex-end" },
  bubbleWrapTheirs: { alignItems: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: radii.sm },
  bubbleTheirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radii.sm },
  bubbleText: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  bubbleTextMine: { color: "#fff" },
  bubbleTime: { color: colors.textSecondary, fontSize: 9, fontWeight: "700", marginTop: 4, marginHorizontal: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: spacing.lg, paddingTop: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.input,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
