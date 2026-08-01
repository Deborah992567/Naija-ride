// API client + auth helpers for Transport Tracker
import { storage } from "@/src/utils/storage";
import Constants from "expo-constants";

// Resolve the backend URL:
// 1. EXPO_PUBLIC_BACKEND_URL from .env (explicit override).
// 2. Otherwise derive the host from Expo's hostUri so Expo Go / dev
//    builds on a real device automatically target the dev machine.
// Backend runs on port 8001 (8000 is reserved for an unrelated local app).
function resolveBackendUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:8001`;
  }
  return "http://localhost:8001";
}

const BASE_URL = resolveBackendUrl();
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

export type CrowdHour = {
  hour: number;
  avg_crowd: "empty" | "moderate" | "packed" | null;
  report_count: number;
};

export type CrowdAnalytics = {
  route_id: string;
  days: number;
  total_reports: number;
  by_hour: CrowdHour[];
};

export type Follow = {
  route_id: string;
  created_at: string;
};

// ---- Ride-hailing ----
export type VehicleType = "car" | "keke";
export type PaymentMethod = "cash" | "card" | "transfer";
export type RideStatus =
  | "requested"
  | "accepted"
  | "arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

export type DriverProfile = {
  user_id: string;
  name: string | null;
  vehicle_type: VehicleType;
  vehicle_plate: string | null;
  vehicle_color: string | null;
  vehicle_model: string | null;
  phone: string | null;
  is_online: number;
  current_lat: number | null;
  current_lng: number | null;
  rating: number;
  trips_completed: number;
};

export type ZoneInfo = {
  zone_name: string;
  city: string;
  disallowed_vehicle_types: VehicleType[];
};

export type RideEstimate = {
  distance_km: number;
  eta_minutes: number;
  fare: number;
  allowed: boolean;
  reason: string | null;
  zones: ZoneInfo[];
  payment_methods: PaymentMethod[];
};

export type RideOut = {
  ride_id: string;
  rider_id: string;
  driver: {
    user_id: string;
    name: string | null;
    rating: number;
    trips_completed: number;
    vehicle_type: VehicleType;
    vehicle_plate: string | null;
    vehicle_color: string | null;
    vehicle_model: string | null;
    current_lat: number | null;
    current_lng: number | null;
  } | null;
  vehicle_type: VehicleType;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string | null;
  distance_km: number;
  fare_estimate: number;
  payment_method: PaymentMethod | null;
  status: RideStatus;
  driver_eta_minutes: number | null;
  created_at: string;
};

export type TripOut = {
  trip_id: string;
  ride_id: string;
  rider_id: string;
  driver_id: string;
  fare: number;
  payment_method: PaymentMethod;
  payment_status: string;
  status: string;
  rating_driver: number | null;
  rating_rider: number | null;
  started_at: string;
  ended_at: string | null;
};

export type CardPayOut = {
  payment_id: string;
  authorization_url: string;
  reference: string;
};

export type TransferOut = {
  payment_id: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  amount: number;
  reference: string;
  status: string;
};

export type RideEvent =
  | { event: "connected"; role: "driver" | "rider" }
  | { event: "ride.request"; [k: string]: unknown }
  | { event: "ride.accepted"; ride_id: string; [k: string]: unknown }
  | { event: "ride.status"; ride_id: string; status: RideStatus; message?: string }
  | { event: "driver.location"; ride_id: string; lat: number; lng: number }
  | { event: "ride.cancelled"; ride_id: string }
  | { event: "ride.completed"; trip_id: string; ride_id: string; fare: number };

export function ridesWsUrl(role: "driver" | "rider"): Promise<string> {
  return getToken().then((t) => {
    const wsBase = BASE_URL.replace(/^http/, "ws");
    return `${wsBase}/api/ws/rides?token=${encodeURIComponent(t || "")}&role=${role}`;
  });
}

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}
export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}
export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

const ROUTES_CACHE_KEY = "routes_cache";

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
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string; reset_token?: string | null }>("/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean; message: string }>("/auth/reset", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  // Routes
  listRoutes: async (params?: { city?: string; vehicle_type?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    try {
      const routes = await request<Route[]>(`/routes${qs ? `?${qs}` : ""}`);
      if (!params) {
        await storage.setItem(ROUTES_CACHE_KEY, JSON.stringify(routes));
      }
      return routes;
    } catch (e) {
      // Offline fallback: serve the last-known route list.
      const cached = await storage.getItem<string>(ROUTES_CACHE_KEY, "");
      if (cached) {
        const parsed = JSON.parse(cached) as Route[];
        if (params) {
          return parsed.filter((r) =>
            (!params.city || r.city === params.city) &&
            (!params.vehicle_type || r.vehicle_type === params.vehicle_type),
          );
        }
        return parsed;
      }
      throw e;
    }
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
    device_id?: string;
  }) => request<Report>("/reports", { method: "POST", body: JSON.stringify(body) }, true),
  listReports: (route_id?: string, minutes = 60, user_id?: string) => {
    const qs = new URLSearchParams();
    if (route_id) qs.set("route_id", route_id);
    if (user_id) qs.set("user_id", user_id);
    qs.set("minutes", String(minutes));
    return request<Report[]>(`/reports?${qs.toString()}`);
  },
  flagReport: (report_id: string) =>
    request<{ ok: boolean; status: string }>(`/reports/${report_id}/flag`, { method: "POST" }, true),
  deleteReport: (report_id: string) =>
    request<{ ok: boolean }>(`/reports/${report_id}`, { method: "DELETE" }, true),
  liveVehicles: (vehicle_type?: string, minutes = 15) => {
    const qs = new URLSearchParams();
    if (vehicle_type) qs.set("vehicle_type", vehicle_type);
    qs.set("minutes", String(minutes));
    return request<Report[]>(`/vehicles/live?${qs.toString()}`);
  },
  eta: (route_id: string, stop_id: number) =>
    request<Eta>(`/eta?route_id=${route_id}&stop_id=${stop_id}`),

  // Follows / notifications
  listFollows: () => request<Follow[]>("/follows", {}, true),
  followRoute: (route_id: string) =>
    request<Follow>(`/follows/${route_id}`, { method: "POST" }, true),
  unfollowRoute: (route_id: string) =>
    request<{ ok: boolean }>(`/follows/${route_id}`, { method: "DELETE" }, true),
  registerPushToken: (push_token: string) =>
    request<{ ok: boolean }>("/me/push-token", {
      method: "POST",
      body: JSON.stringify({ push_token }),
    }, true),

  // Analytics
  crowdAnalytics: (route_id: string, days = 7) =>
    request<CrowdAnalytics>(`/analytics/crowd?route_id=${route_id}&days=${days}`),

  // ---- Ride-hailing: drivers ----
  driverRegister: (body: {
    vehicle_type: VehicleType;
    vehicle_plate?: string;
    vehicle_color?: string;
    vehicle_model?: string;
    phone?: string;
  }) => request<DriverProfile>("/drivers/register", { method: "POST", body: JSON.stringify(body) }, true),
  driverMe: () => request<DriverProfile>("/drivers/me", {}, true),
  driverStatus: (is_online: boolean, lat: number, lng: number) =>
    request<DriverProfile>("/drivers/status", {
      method: "POST",
      body: JSON.stringify({ is_online, lat, lng }),
    }, true),
  driversNearby: (lat: number, lng: number, vehicle_type?: VehicleType) => {
    const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (vehicle_type) qs.set("vehicle_type", vehicle_type);
    return request<DriverProfile[]>(`/drivers/nearby?${qs.toString()}`);
  },

  // ---- Ride-hailing: zones + estimate ----
  listZones: () => request<ZoneInfo[]>("/zones"),
  estimateRide: (body: {
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    vehicle_type: VehicleType;
  }) => request<RideEstimate>("/rides/estimate", { method: "POST", body: JSON.stringify(body) }),

  // ---- Ride-hailing: ride lifecycle ----
  requestRide: (body: {
    pickup_lat: number;
    pickup_lng: number;
    pickup_address?: string;
    dropoff_lat: number;
    dropoff_lng: number;
    dropoff_address?: string;
    vehicle_type: VehicleType;
    payment_method?: PaymentMethod;
  }) => request<RideOut>("/rides", { method: "POST", body: JSON.stringify(body) }, true),
  getRide: (ride_id: string) => request<RideOut>(`/rides/${ride_id}`, {}, true),
  cancelRide: (ride_id: string) => request<RideOut>(`/rides/${ride_id}/cancel`, { method: "POST" }, true),
  acceptRide: (ride_id: string) => request<RideOut>(`/rides/${ride_id}/accept`, { method: "POST" }, true),
  declineRide: (ride_id: string) => request<RideOut>(`/rides/${ride_id}/decline`, { method: "POST" }, true),
  arriveRide: (ride_id: string) => request<RideOut>(`/rides/${ride_id}/arrive`, { method: "POST" }, true),
  startRide: (ride_id: string) => request<RideOut>(`/rides/${ride_id}/start`, { method: "POST" }, true),
  completeRide: (ride_id: string) => request<TripOut>(`/rides/${ride_id}/complete`, { method: "POST" }, true),
  setPaymentMethod: (ride_id: string, payment_method: PaymentMethod) =>
    request<RideOut>(`/rides/${ride_id}/payment-method`, {
      method: "POST",
      body: JSON.stringify({ payment_method }),
    }, true),

  // ---- Ride-hailing: payments + rating ----
  initCardPayment: (ride_id: string, amount: number) =>
    request<CardPayOut>("/payments/card", {
      method: "POST",
      body: JSON.stringify({ ride_id, amount }),
    }, true),
  verifyCardPayment: (payment_id: string) =>
    request<{ ok: boolean; status: string }>(`/payments/card/verify?payment_id=${encodeURIComponent(payment_id)}`, {
      method: "POST",
    }, true),
  transferDetails: (ride_id: string) =>
    request<TransferOut>(`/payments/transfer/${ride_id}`, {}, true),
  rateTrip: (trip_id: string, rating: number) =>
    request<{ ok: boolean; rating: number }>(`/trips/${trip_id}/rate`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    }, true),
};
