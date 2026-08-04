import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radii, spacing } from "@/src/lib/theme";

const { width, height } = Dimensions.get("window");

const slides = [
  {
    title: "Know your ride",
    body: "See live buses, danfos, bikes and campus shuttles around you.",
    image: require("../assets/images/onboarding/onboard_1.jpeg"),
  },
  {
    title: "Real-time ETAs",
    body: "Stop guessing. Get arrival times powered by riders just like you.",
    image: require("../assets/images/onboarding/onboard_2.jpeg"),
  },
  {
    title: "Never wait aimlessly",
    body: "Report sightings, crowd levels and fare changes. Earn karma for helping the community.",
    image: require("../assets/images/onboarding/onboard_3.jpeg"),
  },
];

export default function Onboarding() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== idx) setIdx(i);
  };

  const next = () => {
    if (idx < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: idx + 1, animated: true });
    } else {
      router.replace("/(auth)/login");
    }
  };

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <ImageBackground source={item.image} style={{ width, height }} resizeMode="cover">
            <LinearGradient
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.92)"]}
              style={StyleSheet.absoluteFill}
            />
            <SafeAreaView style={styles.slideContent} edges={["top", "bottom"]}>
              <View style={styles.topBrand}>
                <View style={styles.brandDot} />
                <Text style={styles.brandText}>NaijaMove</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text style={styles.title} testID={`onboarding-title-${idx}`}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </SafeAreaView>
          </ImageBackground>
        )}
      />

      <SafeAreaView style={styles.footer} edges={["bottom"]}>
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, i === idx && styles.dotActive]} />
          ))}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => router.replace("/(auth)/login")}
            style={styles.skipBtn}
            testID="onboarding-skip-button"
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={next}
            style={styles.nextBtn}
            testID="onboarding-next-button"
          >
            <Text style={styles.nextText}>{idx === slides.length - 1 ? "Get started" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  slideContent: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: 180 },
  topBrand: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md },
  brandDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.secondary },
  brandText: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: 0.5 },
  title: { color: "#fff", fontSize: 36, fontWeight: "900", lineHeight: 42, marginBottom: spacing.sm },
  body: { color: "rgba(255,255,255,0.85)", fontSize: 17, lineHeight: 24 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  dots: { flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.4)" },
  dotActive: { backgroundColor: colors.secondary, width: 22 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  skipBtn: { paddingVertical: 14, paddingHorizontal: 18 },
  skipText: { color: "rgba(255,255,255,0.8)", fontSize: 16, fontWeight: "600" },
  nextBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 16,
    alignItems: "center",
  },
  nextText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
});
