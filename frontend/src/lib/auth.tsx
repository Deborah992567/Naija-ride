// Auth context — bootstraps token from secure storage, provides login/register/google flows.
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, clearToken, getToken, setToken, User } from "./api";
import { registerForPushNotifications } from "./notifications";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

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
      void registerForPushNotifications();
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

  async function signIn(email: string, password: string) {
    const { token, user: u } = await api.login(email, password);
    await setToken(token);
    setUser(u);
    void registerForPushNotifications();
  }

  async function signUp(email: string, password: string, name?: string) {
    const { token, user: u } = await api.register(email, password, name);
    await setToken(token);
    setUser(u);
    void registerForPushNotifications();
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
    void registerForPushNotifications();
  }

  async function signOut() {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInGoogle, signOut, refresh: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
