// Debounced location search with live suggestions (OpenStreetMap via backend).
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type Place } from "@/src/lib/api";
import { colors, radii } from "@/src/lib/theme";

type Props = {
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  testID?: string;
  style?: ViewStyle;
};

export default function PlaceAutocomplete({ placeholder, value, onChange, testID, style }: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [suggestions, setSuggestions] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = text.trim();
    if (q.length < 2) {
      setSuggestions(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchPlaces(q);
        setSuggestions(res);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const select = (p: Place) => {
    onChange(p);
    setQuery(p.name);
    setSuggestions(null);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    setSuggestions(null);
  };

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.inputRow}>
        <Ionicons name="location" size={17} color={colors.primary} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={handleChange}
          returnKeyType="search"
          autoCorrect={false}
          testID={testID ? `${testID}-input` : undefined}
        />
        {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        {query ? (
          <TouchableOpacity onPress={clear} hitSlop={10} testID={testID ? `${testID}-clear` : undefined}>
            <Ionicons name="close-circle" size={19} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {suggestions ? (
        <View style={styles.dropdown} testID={testID ? `${testID}-dropdown` : undefined}>
          {suggestions.length === 0 ? (
            <Text style={styles.noResults}>No places found for “{query.trim()}”</Text>
          ) : (
            suggestions.map((p) => (
              <TouchableOpacity
                key={`${p.lat},${p.lng},${p.name}`}
                style={styles.suggestion}
                onPress={() => select(p)}
                testID={testID ? `${testID}-suggestion` : undefined}
              >
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionName} numberOfLines={2}>{p.name}</Text>
                  <Text style={styles.suggestionCity}>{[p.city, p.state].filter(Boolean).join(" · ")}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 10 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    paddingHorizontal: 13,
    minHeight: 48,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "600", paddingVertical: 12 },
  dropdown: {
    position: "absolute",
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    maxHeight: 300,
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionName: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  suggestionCity: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 1 },
  noResults: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", padding: 14 },
});
