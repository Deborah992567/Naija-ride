// FilterChip horizontal row — chrome above lists, doesn't wrap.
import { ScrollView, TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii } from "@/src/lib/theme";

export type ChipItem = { key: string; label: string; icon?: keyof typeof Ionicons.glyphMap };

export default function FilterChips({
  items,
  value,
  onChange,
  testIDPrefix,
}: {
  items: ChipItem[];
  value: string;
  onChange: (key: string) => void;
  testIDPrefix?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <TouchableOpacity
            key={it.key}
            onPress={() => onChange(it.key)}
            style={[styles.chip, active && styles.chipActive]}
            testID={`${testIDPrefix || "chip"}-${it.key}`}
            activeOpacity={0.85}
          >
            {it.icon && (
              <Ionicons
                name={it.icon}
                size={14}
                color={active ? colors.primary : colors.textSecondary}
              />
            )}
            <Text style={[styles.label, active && styles.labelActive]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
      <View style={{ width: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { height: 56 },
  row: { paddingHorizontal: 16, gap: 8, alignItems: "center", height: 56 },
  chip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  labelActive: { color: colors.primary, fontWeight: "800" },
});
