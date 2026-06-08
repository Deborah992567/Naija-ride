import { Redirect } from "expo-router";

export default function Index() {
  // NavGuard in _layout will redirect; default to tabs (it'll bounce out if not logged in).
  return <Redirect href="/(tabs)" />;
}
