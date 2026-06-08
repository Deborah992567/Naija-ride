// API client + auth helpers for Transport Tracker
import { storage } from "@/src/utils/storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API = `${BASE_URL}/api`;
const TOKEN_KEY = "tt_token";

export type User = {
  user_id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  karma: number;
  provider: string;
  created_at: string;
};

export type Stop = { name: string; lat: number; lng: number };

export type Route = {
  route_id: string;
  name: string;
  description: string;
  vehicle_type: "bus" | "danfo" | "keke" | "shuttle";
  city: string;
  stops: Stop[];
  fare: number | null;
  created_by: string | null;
  created_at: string;
};

export type Report = {
  report_id: string;
  route_id: string;
  type: "sighting" | "onboard" | "delay" | "fare";
  vehicle_type: "bus" | "danfo" | "keke" | "shuttle";
  lat: number;
  lng: number;
  crowd_level: "empty" | "moderate" | "packed" | null;
  delay_minutes: number | null;
  fare: number | null;
  note: string | null;
  user_id: string;
  user_name: string | null;
  created_at: string;
};

export type Eta = {
  route_id: string;
  stop_id: number;
  eta_minutes: number | null;
  last_seen_minutes_ago: number | null;
  distance_km: number | null;
  confidence: "high" | "medium" | "low" | "none";
};

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}
export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}
export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(path: string, opts: RequestInit = {}, withAuth = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (withAuth) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {}
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// Auth
export const api = {
  register: (email: string, password: string, name?: string) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  googleSession: (session_id: string) =>
    request<{ token: string; user: User }>("/auth/google-session", {
      method: "POST",
      body: JSON.stringify({ session_id }),
    }),
  me: () => request<User>("/auth/me", {}, true),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }, true),

  // Routes
  listRoutes: (params?: { city?: string; vehicle_type?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Route[]>(`/routes${qs ? `?${qs}` : ""}`);
  },
  getRoute: (route_id: string) => request<Route>(`/routes/${route_id}`),
  createRoute: (body: Partial<Route>) =>
    request<Route>("/routes", { method: "POST", body: JSON.stringify(body) }, true),

  // Reports
  submitReport: (body: {
    route_id: string;
    type: "sighting" | "onboard" | "delay" | "fare";
    vehicle_type: string;
    lat: number;
    lng: number;
    crowd_level?: string;
    delay_minutes?: number;
    fare?: number;
    note?: string;
  }) => request<Report>("/reports", { method: "POST", body: JSON.stringify(body) }, true),
  listReports: (route_id?: string, minutes = 60) => {
    const qs = new URLSearchParams();
    if (route_id) qs.set("route_id", route_id);
    qs.set("minutes", String(minutes));
    return request<Report[]>(`/reports?${qs.toString()}`);
  },
  liveVehicles: (vehicle_type?: string, minutes = 15) => {
    const qs = new URLSearchParams();
    if (vehicle_type) qs.set("vehicle_type", vehicle_type);
    qs.set("minutes", String(minutes));
    return request<Report[]>(`/vehicles/live?${qs.toString()}`);
  },
  eta: (route_id: string, stop_id: number) =>
    request<Eta>(`/eta?route_id=${route_id}&stop_id=${stop_id}`),
};
