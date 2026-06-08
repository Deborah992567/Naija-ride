// Crowd level visual indicator (3 bars).
import { View, StyleSheet } from "react-native";
import { crowdMeta } from "@/src/lib/theme";

export default function CrowdBars({ level, size = "md" }: { level: "empty" | "moderate" | "packed"; size?: "sm" | "md" }) {
  const meta = crowdMeta[level];
  const heights = size === "sm" ? [6, 9, 12] : [8, 12, 16];
  const widths = size === "sm" ? 3 : 4;
  return (
    <View style={styles.row}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: widths,
            height: heights[i],
            backgroundColor: i < meta.bars ? meta.color : "#E2E8F0",
            borderRadius: 1.5,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
});
