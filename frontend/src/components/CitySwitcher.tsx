// Horizontal city picker with persisted selection.
import { useEffect, useState } from "react";
import { Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { storage } from "@/src/utils/storage";
import { colors, radii } from "@/src/lib/theme";

const CITIES = ["All", "Lagos", "Abuja", "Port Harcourt", "Campus"] as const;
const KEY = "city_filter";

export default function CitySwitcher({
  value,
  onChange,
  testIDPrefix = "city",
}: {
  value: string;
  onChange: (city: string) => void;
  testIDPrefix?: string;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(KEY, "");
      if (saved && CITIES.includes(saved as (typeof CITIES)[number])) {
        onChange(saved);
      }
      setReady(true);
    })();
  }, [onChange]);

  async function select(city: string) {
    onChange(city);
    await storage.setItem(KEY, city);
  }

  if (!ready) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {CITIES.map((city) => {
        const active = value === city;
        return (
          <TouchableOpacity
            key={city}
            onPress={() => select(city)}
            style={[styles.chip, active && styles.chipActive]}
            testID={`${testIDPrefix}-switch-${city.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <Text style={[styles.text, active && styles.textActive]}>{city}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.input,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  text: { fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  textActive: { color: "#fff" },
});
