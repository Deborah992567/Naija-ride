// Auth context — bootstraps token from secure storage, provides login/register/google flows.
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, clearToken, getToken, setToken, User } from "./api";
import { registerForPushNotifications } from "./push";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string, state?: string, referral_code?: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: (password?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Landing screen for each role: admins get the console, drivers get the job
// dashboard, everyone else (riders / regular users) gets the ride screen.
export function roleHome(user: User | null): "/onboarding" | "/(tabs)/admin" | "/(tabs)/drive" | "/(tabs)/ride" {
  if (!user) return "/onboarding";
  if (user.is_admin === 1 || user.role === "admin") return "/(tabs)/admin";
  if (user.role === "driver") return "/(tabs)/drive";
  return "/(tabs)/ride";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  // Re-register the push token whenever a signed-in session is (re)established.
  useEffect(() => {
    if (user) {
      registerForPushNotifications().catch(() => {});
    }
  }, [user?.user_id]);

  async function signIn(email: string, password: string) {
    const { token, user: u } = await api.login(email, password);
    await setToken(token);
    setUser(u);
  }

  async function signUp(email: string, password: string, name?: string, state?: string, referral_code?: string) {
    const { token, user: u } = await api.register(email, password, name, state, referral_code);
    await setToken(token);
    setUser(u);
  }

  async function signInGoogle() {
    const redirectUrl =
      Platform.OS === "web"
        ? `${(globalThis as { location?: { origin?: string } }).location?.origin || ""}/`
        : Linking.createURL("auth");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      (globalThis as { location?: { href?: string } }).location!.href = authUrl;
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type !== "success" || !result.url) return;
    const parsed = Linking.parse(result.url);
    const sid =
      (parsed.queryParams?.session_id as string | undefined) ||
      // try fragment
      (result.url.includes("#session_id=") ? result.url.split("#session_id=")[1].split("&")[0] : undefined);
    if (!sid) return;
    const { token, user: u } = await api.googleSession(sid);
    await setToken(token);
    setUser(u);
  }

  async function signOut() {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }

  async function deleteAccount(password?: string) {
    await api.deleteAccount(password);
    await clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, signInGoogle, signOut, deleteAccount, refresh: loadMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
