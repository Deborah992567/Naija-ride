// API client + auth helpers for Naija Ride
import { storage } from "@/src/utils/storage";
import Constants from "expo-constants";

// Resolve the backend URL:
// 1. EXPO_PUBLIC_BACKEND_URL from .env (explicit override).
// 2. Otherwise derive the host from Expo's hostUri so Expo Go / dev
//    builds on a real device automatically target the dev machine.
// Backend runs on port 8001 (8000 is reserved for an unrelated local app).
function resolveBackendUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.replace(/\/+$/, "");
  const candidates: string[] = [];
  const expoConfig = (Constants as { expoConfig?: { hostUri?: string } | null }).expoConfig;
  if (expoConfig?.hostUri) candidates.push(expoConfig.hostUri);
  // Older Expo Go builds expose the debugger host via the manifest/platform.
  const platform = (Constants as { platform?: { hostUri?: string } | null }).platform;
  if (platform?.hostUri) candidates.push(platform.hostUri);
  for (const hostUri of candidates) {
    const host = hostUri.split(":")[0];
    if (host && !host.includes("[")) return `http://${host}:8001`;
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
  role: "user" | "driver" | "admin";
  state?: string | null;
  is_admin: number;
  referral_code?: string | null;
  created_at: string;
};

// ---- Ride-hailing ----
export type VehicleType = "car" | "bike";
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
  profile_photo: string | null;
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
    profile_photo: string | null;
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

export type DriverEta = { minutes: number; target: "pickup" | "dropoff" };

export type RideEvent =
  | { event: "connected"; role: "driver" | "rider" }
  | { event: "ride.request"; [k: string]: unknown }
  | { event: "ride.accepted"; ride_id: string; [k: string]: unknown }
  | { event: "ride.status"; ride_id: string; status: RideStatus; message?: string }
  | { event: "driver.location"; ride_id: string; lat: number; lng: number; eta_minutes?: number; target?: "pickup" | "dropoff" }
  | { event: "driver.eta"; ride_id?: string; delivery_id?: string; booking_id?: string; eta_minutes: number; target: "pickup" | "dropoff" }
  | { event: "ride.cancelled"; ride_id: string }
  | { event: "ride.completed"; trip_id: string; ride_id: string; fare: number };

export function ridesWsUrl(role: "driver" | "rider"): Promise<string> {
  return getToken().then((t) => {
    const wsBase = BASE_URL.replace(/^http/, "ws");
    return `${wsBase}/api/ws/rides?token=${encodeURIComponent(t || "")}&role=${role}`;
  });
}

export function chatWsUrl(): Promise<string> {
  return getToken().then((t) => {
    const wsBase = BASE_URL.replace(/^http/, "ws");
    return `${wsBase}/api/ws/chat?token=${encodeURIComponent(t || "")}`;
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

export function toFormData(file: { uri: string; name: string; type: string }): FormData {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  return form;
}

async function request<T>(path: string, opts: RequestInit = {}, withAuth = false): Promise<T> {
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
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
  register: (email: string, password: string, name?: string, state?: string, referral_code?: string) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name, state, referral_code }),
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
  assistant: (message: string) =>
    request<{ reply: string; mode: "ai" | "faq" }>("/assistant/message", {
      method: "POST",
      body: JSON.stringify({ message }),
    }, true),
  registerPushToken: (push_token: string) =>
    request<{ ok: boolean }>("/me/push-token", {
      method: "POST",
      body: JSON.stringify({ push_token }),
    }, true),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }, true),
  deleteAccount: (password?: string) =>
    request<{ ok: boolean; message: string }>("/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    }, true),
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
    coupon_code?: string;
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

  // ---- Admin: driver verification + payouts ----
  adminVerifications: (status?: string) =>
    request<AdminVerification[]>(`/admin/drivers/verifications${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminReviewVerification: (user_id: string, decision: "verified" | "rejected", note?: string) =>
    request<AdminVerification>(`/admin/drivers/${user_id}/verify`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }, true),
  adminWithdrawals: (status?: string) =>
    request<Withdrawal[]>(`/admin/withdrawals${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminReviewWithdrawal: (request_id: string, decision: "approved" | "rejected" | "paid", note?: string) =>
    request<Withdrawal>(`/admin/withdrawals/${request_id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }, true),

  // ---- Coupons / promos ----
  adminCoupons: () => request<Coupon[]>("/admin/coupons", {}, true),
  adminCreateCoupon: (body: CouponCreate) =>
    request<Coupon>("/admin/coupons", { method: "POST", body: JSON.stringify(body) }, true),
  adminToggleCoupon: (coupon_id: string) =>
    request<Coupon>(`/admin/coupons/${coupon_id}/toggle`, { method: "POST" }, true),
  adminCouponRedemptions: (coupon_id: string) =>
    request<CouponRedemption[]>(`/admin/coupons/${coupon_id}/redemptions`, {}, true),
  validateCoupon: (code: string, scope: string, fare: number) =>
    request<CouponValidateOut>("/coupons/validate", {
      method: "POST",
      body: JSON.stringify({ code, scope, fare }),
    }, true),
  myCoupons: () => request<CouponRedemption[]>("/coupons/my", {}, true),

  // ---- Referral program ----
  myReferrals: () => request<ReferralOut>("/referrals", {}, true),
  applyReferral: (code: string) =>
    request<ReferralApplyOut>("/referrals/apply", {
      method: "POST",
      body: JSON.stringify({ code }),
    }, true),

  // ---- Notifications ----
  myNotifications: (limit = 30) =>
    request<Notification[]>(`/notifications?limit=${limit}`, {}, true),
  unreadCount: () => request<{ count: number }>("/notifications/unread-count", {}, true),
  markNotificationRead: (notification_id: string) =>
    request<Notification>(`/notifications/${notification_id}/read`, { method: "POST" }, true),
  markAllNotificationsRead: () =>
    request<{ ok: boolean; marked: number }>("/notifications/read-all", { method: "POST" }, true),

  // ---- Safety: emergency contacts + SOS + trip share ----
  emergencyContacts: () => request<EmergencyContact[]>("/safety/contacts", {}, true),
  addEmergencyContact: (name: string, phone: string) =>
    request<EmergencyContact>("/safety/contacts", {
      method: "POST",
      body: JSON.stringify({ name, phone }),
    }, true),
  removeEmergencyContact: (contact_id: string) =>
    request<{ ok: boolean }>(`/safety/contacts/${contact_id}`, { method: "DELETE" }, true),
  raiseEmergency: (body: { ride_id?: string; message?: string; lat?: number; lng?: number }) =>
    request<EmergencyRecord>("/safety/emergency", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),
  resolveEmergency: (emergency_id: string) =>
    request<EmergencyRecord>(`/safety/emergency/${emergency_id}/resolve`, { method: "POST" }, true),
  myEmergencies: () => request<EmergencyRecord[]>("/safety/emergency/my", {}, true),
  shareRide: (ride_id: string) =>
    request<TripShareOut>(`/rides/${ride_id}/share`, { method: "POST" }, true),

  // ---- Job chat (ride / delivery / moving) ----
  chatMessages: (ride_id: string) =>
    request<ChatMessage[]>(`/rides/${ride_id}/messages`, {}, true),
  sendChatMessage: (ride_id: string, body: string) =>
    request<ChatMessage>(`/rides/${ride_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, true),
  deliveryMessages: (delivery_id: string) =>
    request<ChatMessage[]>(`/delivery/${delivery_id}/messages`, {}, true),
  sendDeliveryMessage: (delivery_id: string, body: string) =>
    request<ChatMessage>(`/delivery/${delivery_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, true),
  movingMessages: (booking_id: string) =>
    request<ChatMessage[]>(`/moving/${booking_id}/messages`, {}, true),
  sendMovingMessage: (booking_id: string, body: string) =>
    request<ChatMessage>(`/moving/${booking_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, true),
  chatContact: (entity_type: "ride" | "delivery" | "moving", entity_id: string) =>
    request<ChatContact>(`/chat/contact/${entity_type}/${entity_id}`, {}, true),

  // ---- Places (OpenStreetMap search + reverse geocode) ----
  searchPlaces: (q: string, limit = 8) =>
    request<Place[]>(`/places/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  reverseGeocode: (lat: number, lng: number) =>
    request<Place>(`/places/reverse?lat=${lat}&lng=${lng}`),

  // ---- Delivery ----
  deliveryQuote: (body: {
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    package_type?: DeliveryPackageType;
    weight_kg?: number | null;
  }) => request<DeliveryQuoteOut>("/delivery/quote", { method: "POST", body: JSON.stringify(body) }, true),
  createDelivery: (body: DeliveryCreateReq) =>
    request<DeliveryOut>("/delivery", { method: "POST", body: JSON.stringify(body) }, true),
  myDeliveries: (role: "requester" | "driver" = "requester") =>
    request<DeliveryOut[]>(`/delivery?role=${role}`, {}, true),
  getDelivery: (delivery_id: string) => request<DeliveryOut>(`/delivery/${delivery_id}`, {}, true),
  acceptDelivery: (delivery_id: string) =>
    request<DeliveryOut>(`/delivery/${delivery_id}/accept`, { method: "POST" }, true),
  pickupDelivery: (delivery_id: string) =>
    request<DeliveryOut>(`/delivery/${delivery_id}/pickup`, { method: "POST" }, true),
  startDelivery: (delivery_id: string) =>
    request<DeliveryOut>(`/delivery/${delivery_id}/start`, { method: "POST" }, true),
  completeDelivery: (delivery_id: string) =>
    request<DeliveryOut>(`/delivery/${delivery_id}/complete`, { method: "POST" }, true),
  cancelDelivery: (delivery_id: string) =>
    request<DeliveryOut>(`/delivery/${delivery_id}/cancel`, { method: "POST" }, true),
  setDeliveryPayment: (delivery_id: string, payment_method: string) =>
    request<DeliveryOut>(`/delivery/${delivery_id}/payment-method`, {
      method: "POST",
      body: JSON.stringify({ payment_method }),
    }, true),

  // ---- Moving ----
  movingQuote: (body: {
    origin_lat: number;
    origin_lng: number;
    destination_lat: number;
    destination_lng: number;
    move_type?: MovingType;
    truck_size?: TruckSize;
  }) => request<MovingQuoteOut>("/moving/quote", { method: "POST", body: JSON.stringify(body) }, true),
  createMoving: (body: MovingCreateReq) =>
    request<MovingOut>("/moving", { method: "POST", body: JSON.stringify(body) }, true),
  myMoving: (role: "customer" | "driver" = "customer") =>
    request<MovingOut[]>(`/moving?role=${role}`, {}, true),
  getMoving: (booking_id: string) => request<MovingOut>(`/moving/${booking_id}`, {}, true),
  acceptMoving: (booking_id: string) =>
    request<MovingOut>(`/moving/${booking_id}/accept`, { method: "POST" }, true),
  startMoving: (booking_id: string) =>
    request<MovingOut>(`/moving/${booking_id}/start`, { method: "POST" }, true),
  completeMoving: (booking_id: string) =>
    request<MovingOut>(`/moving/${booking_id}/complete`, { method: "POST" }, true),
  cancelMoving: (booking_id: string) =>
    request<MovingOut>(`/moving/${booking_id}/cancel`, { method: "POST" }, true),
  setMovingPayment: (booking_id: string, payment_method: string) =>
    request<MovingOut>(`/moving/${booking_id}/payment-method`, {
      method: "POST",
      body: JSON.stringify({ payment_method }),
    }, true),

  // ---- Wallet ----
  walletDetail: () => request<WalletDetail>("/wallet", {}, true),
  walletTopup: (amount: number) =>
    request<CardPayOut>("/wallet/topup", { method: "POST", body: JSON.stringify({ amount }) }, true),
  verifyWalletTopup: (reference: string) =>
    request<{ ok: boolean; status: string }>(`/wallet/topup/verify?reference=${encodeURIComponent(reference)}`, {
      method: "POST",
    }, true),
  walletEarnings: () => request<EarningsOut>("/wallet/earnings", {}, true),
  withdraw: (body: { amount: number; bank_name: string; bank_account_name: string; bank_account_number: string }) =>
    request<Withdrawal>("/wallet/withdraw", { method: "POST", body: JSON.stringify(body) }, true),
  myWithdrawals: () => request<Withdrawal[]>("/wallet/withdrawals", {}, true),

  // ---- History ----
  ridesHistory: (role: "customer" | "driver" = "customer") =>
    request<RideOut[]>(`/rides?role=${role}`, {}, true),
  paymentsHistory: (role: "customer" | "driver" = "customer") =>
    request<PaymentRecord[]>(`/payments?role=${role}`, {}, true),

  // ---- Support tickets ----
  createTicket: (body: { subject: string; category: string; priority: string; body: string }) =>
    request<SupportTicket>("/tickets", { method: "POST", body: JSON.stringify(body) }, true),
  myTickets: () => request<SupportTicket[]>("/tickets", {}, true),
  getTicket: (ticket_id: string) => request<SupportTicket>(`/tickets/${ticket_id}`, {}, true),
  replyTicket: (ticket_id: string, body: string) =>
    request<SupportTicket>(`/tickets/${ticket_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, true),
  closeTicket: (ticket_id: string) =>
    request<SupportTicket>(`/tickets/${ticket_id}/close`, { method: "POST" }, true),

  // ---- Admin ----
  adminStats: () => request<AdminStats>("/admin/stats", {}, true),
  adminUsers: (search = "", role = "") => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (role) params.set("role", role);
    const qs = params.toString();
    return request<AdminUser[]>(`/admin/users${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminSetUserStatus: (user_id: string, status: "active" | "suspended") =>
    request<{ ok: boolean; status: string }>(`/admin/users/${user_id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }, true),
  adminRides: (status = "") =>
    request<AdminRide[]>(`/admin/rides${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminDeliveries: (status = "") =>
    request<AdminDelivery[]>(`/admin/deliveries${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminMoving: (status = "") =>
    request<AdminMoving[]>(`/admin/moving${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminPayments: (status = "") =>
    request<PaymentRecord[]>(`/admin/payments${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminTickets: (status = "") =>
    request<SupportTicket[]>(`/admin/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, true),
  adminSetTicketStatus: (ticket_id: string, status: string) =>
    request<SupportTicket>(`/admin/tickets/${ticket_id}/status?status=${encodeURIComponent(status)}`, {
      method: "POST",
    }, true),

  // ---- Upload (documents / photos) ----
  uploadFile: (file: { uri: string; name: string; type: string }) =>
    request<{ url: string }>("/upload", { method: "POST", body: toFormData(file) }, true),

  // ---- Driver verification ----
  getDriverVerification: () => request<DriverVerification>("/drivers/verification", {}, true),
  submitDriverVerification: (body: {
    id_type: string;
    id_number: string;
    license_number?: string | null;
    license_expiry?: string | null;
    profile_photo?: string | null;
    document_urls?: string[];
  }) => request<DriverVerification>("/drivers/verification", { method: "POST", body: JSON.stringify(body) }, true),
};

export type AdminVerification = {
  user_id: string;
  name: string | null;
  email: string;
  vehicle_type: string;
  vehicle_plate: string | null;
  verification_status: string;
  verification_note: string | null;
  id_type: string | null;
  id_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  document_urls: string[];
  submitted_at: string | null;
};

export type WithdrawalStatus = "pending" | "approved" | "rejected" | "paid";
export type Withdrawal = {
  request_id: string;
  amount: number;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  status: WithdrawalStatus;
  admin_note: string | null;
  processed_at: string | null;
  created_at: string;
};

export type CouponAudience = "rider" | "driver";
export type CouponScope = "ride" | "delivery" | "moving" | "all";
export type DiscountType = "percent" | "fixed";

export type Coupon = {
  coupon_id: string;
  code: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  audience: CouponAudience;
  scope: CouponScope;
  min_trip_fare: number;
  max_discount: number | null;
  valid_from: string;
  valid_to: string;
  max_uses: number;
  used_count: number;
  active: number;
};

export type CouponCreate = {
  code: string;
  description?: string | null;
  discount_type: DiscountType;
  discount_value: number;
  audience: CouponAudience;
  scope: CouponScope;
  min_trip_fare?: number;
  max_discount?: number | null;
  valid_from: string;
  valid_to: string;
  max_uses?: number;
};

export type CouponRedemption = {
  redemption_id: string;
  coupon_id: string;
  user_id: string;
  entity_id: string | null;
  discount: number;
  created_at: string;
};

export type CouponValidateOut = {
  coupon_id: string;
  code: string;
  discount: number;
  fare_after: number;
};

export type ReferralUser = {
  user_id: string;
  name: string | null;
  email: string;
  created_at: string;
};

export type ReferralOut = {
  referral_code: string;
  referral_link: string;
  referrer_reward: number;
  referred_reward: number;
  referrals: ReferralUser[];
  total_rewards: number;
};

export type ReferralApplyOut = {
  referrer_user_id: string;
  referrer_reward: number;
  reward: number;
};

export type Notification = {
  notification_id: string;
  title: string;
  body: string;
  category: string;
  data: { [k: string]: unknown } | null;
  read: boolean;
  created_at: string;
};

export type EmergencyContact = {
  contact_id: string;
  name: string;
  phone: string;
  created_at: string;
};

export type EmergencyRecord = {
  emergency_id: string;
  ride_id: string | null;
  lat: number | null;
  lng: number | null;
  message: string | null;
  status: string;
  created_at: string;
};

export type TripShareOut = {
  share_id: string;
  ride_id: string;
  token: string;
  url: string;
  expires_at: string | null;
};

export type ChatMessage = {
  message_id: string;
  ride_id?: string | null;
  delivery_id?: string | null;
  moving_id?: string | null;
  sender_id: string;
  recipient_id: string | null;
  body: string;
  created_at: string;
};

export type ChatContact = {
  name?: string | null;
  phone?: string | null;
  role: "provider" | "customer";
};

export type Place = {
  name: string;
  lat: number;
  lng: number;
  state: string | null;
  city: string | null;
  category: string | null;
};

// ---- Delivery ----
export type DeliveryPackageType = "parcel" | "food" | "document" | "groceries" | "other";

export type DeliveryQuoteOut = {
  distance_km: number;
  fee: number;
  eta_minutes: number;
  allowed: boolean;
  reason: string | null;
};

export type DeliveryCreateReq = {
  pickup_lat: number;
  pickup_lng: number;
  pickup_address?: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address?: string | null;
  package_type?: DeliveryPackageType;
  weight_kg?: number | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  note?: string | null;
  payment_method?: string;
  coupon_code?: string | null;
};

export type DeliveryDriver = {
  user_id: string;
  name: string | null;
  rating: number;
  trips_completed: number;
  profile_photo: string | null;
  vehicle_type: string;
  vehicle_plate: string | null;
  vehicle_color: string | null;
  vehicle_model: string | null;
  current_lat: number | null;
  current_lng: number | null;
};

export type DeliveryOut = {
  delivery_id: string;
  requester_id: string;
  driver: DeliveryDriver | null;
  package_type: string;
  weight_kg: number | null;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  distance_km: number;
  delivery_fee: number;
  payment_method: string | null;
  payment_status: string;
  status: string;
  note: string | null;
  created_at: string;
};

// ---- Moving ----
export type MovingType = "home" | "office" | "apartment";
export type TruckSize = "small" | "medium" | "large";

export type MovingQuoteOut = {
  distance_km: number;
  fee: number;
  eta_minutes: number;
  allowed: boolean;
  reason: string | null;
};

export type MovingCreateReq = {
  origin_address: string;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_address: string;
  destination_lat?: number | null;
  destination_lng?: number | null;
  move_type?: MovingType;
  truck_size?: TruckSize;
  move_date?: string | null;
  items?: string[] | null;
  note?: string | null;
  payment_method?: string;
  coupon_code?: string | null;
};

export type MovingOut = {
  booking_id: string;
  customer_id: string;
  driver: DeliveryDriver | null;
  move_type: string;
  origin_lat: number | null;
  origin_lng: number | null;
  origin_address: string;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_address: string;
  truck_size: string | null;
  move_date: string | null;
  distance_km: number | null;
  quote_amount: number | null;
  payment_method: string | null;
  payment_status: string;
  status: string;
  note: string | null;
  created_at: string;
};

// ---- Wallet ----
export type WalletTxn = {
  txn_id: string;
  amount: number;
  txn_type: string;
  category: string;
  status: string;
  reference: string | null;
  meta: { [k: string]: unknown } | null;
  created_at: string;
};

export type WalletDetail = {
  wallet_id: string;
  balance: number;
  currency: string;
  transactions: WalletTxn[];
};

export type EarningsOut = {
  commission_percent: number;
  total_earnings: number;
  job_count: number;
};

// ---- History ----
export type PaymentRecord = {
  payment_id: string;
  ride_id: string;
  user_id: string;
  amount: number;
  method: string;
  provider_ref: string | null;
  status: string;
  service_type?: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  created_at: string;
};

// ---- Support tickets ----
export type SupportMessage = {
  message_id: string;
  ticket_id: string;
  user_id: string;
  body: string;
  is_agent: number;
  created_at: string;
};

export type SupportTicket = {
  ticket_id: string;
  user_id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  messages?: SupportMessage[];
  created_at: string;
  updated_at: string;
};

// ---- Admin ----
export type AdminStats = {
  users: number;
  drivers: number;
  rides_total: number;
  rides_active: number;
  rides_completed: number;
  deliveries_active: number;
  deliveries_completed: number;
  moving_active: number;
  moving_completed: number;
  revenue: number;
  payments_pending: number;
};

export type AdminUser = User & {
  phone: string | null;
  state: string | null;
  status: string;
  updated_at: string;
};

export type AdminRide = RideOut & { rider_name?: string; driver_name?: string };

export type AdminDelivery = DeliveryOut & { customer_name?: string; driver_name?: string };

export type AdminMoving = MovingOut & { customer_name?: string; driver_name?: string };

export type DriverVerification = {
  user_id: string;
  verification_status: string;
  verification_note: string | null;
  id_type: string | null;
  id_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  profile_photo: string | null;
  document_urls: string[];
};
