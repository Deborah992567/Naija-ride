# Naija Ride — session memory

## Current product
Multi-service ride & logistics platform: rides, delivery/dispatch, house moving, drivers, payments, wallet, admin.

## Stage 1 — Modular backend refactor (DONE)
- Decision Q&A: modular backend package, admin inside Expo app, drop legacy bus/shuttle tracker.
- Backend refactored from monolith `server.py` (1,935 lines) to package `backend/app/`:
  - `config.py` (DB_URL, JWT_SECRET, PAYSTACK_SECRET_KEY), `db.py` (async engine + get_db)
  - `core/`: geo (haversine/road distance), security (hash/verify/jwt), deps (current_user), realtime (ws_manager), 
  - `models/`: user, driver, rides, payments, zones
  - `schemas/`: auth, drivers, zones, rides, payments
  - `services/`: pricing (FARE_CONFIG, ₦10 rounding, zone_disallowed), drivers (profile_out, nearest_driver_eta), rides (zone rules, ride_out)
  - `routers/`: auth, drivers, zones, rides, payments, realtime (`/api/ws/rides`), health
  - `main.py`: lifespan seeds zone rules, drops obsolete tracker tables (routes/reports/route_follows), CORS, includes routers under `/api`
- `server.py` deleted; Dockerfile updated to `uvicorn app.main:app`.
- Tests: `backend/tests/test_rides_api.py` → 23 passed (transport tracker test file removed).
- Frontend tracker removed: deleted routes/report tabs, `route/[id]` screen, LiveMap/CitySwitcher/FilterChips/CrowdBars components, favorites/notifications/destinations/walking/time libs; `api.ts` purged of Route/Report/ETA/follows methods; home tab is now a service dashboard; profile simplified. `tsc --noEmit` clean.

## Commands
- Backend: `cd backend && /Library/Frameworks/Python.framework/Versions/3.12/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload`
- Tests: `/Library/Frameworks/Python.framework/Versions/3.12/bin/pytest backend/tests/test_rides_api.py -q`
- DB: MariaDB `mysql+asyncmy://root:root1234@localhost/test_db`
- Frontend typecheck: `cd frontend && npx tsc --noEmit`

## Design tokens
`frontend/src/lib/theme.ts`: primary `#008751`, secondary `#FFCC00`, radii/spacing tokens.

## Stage 2 — Full schema for missing domains (DONE)
- Extended `User` (role, phone, email_verified_at) + `DriverProfile` (verification_status, id_type, id_number, license_number, license_expiry, profile_photo, document_urls, verification_note).
- New models (all registered in `models/__init__.py`):
  - `delivery.py`: DeliveryOrder (parcel/food/document, pickup/dropoff, recipient, fee, payment, status)
  - `moving.py`: MovingBooking (move_type, origin/destination, items JSON, truck_size, move_date, quote)
  - `wallet.py`: Wallet, WalletTransaction, WithdrawalRequest (balance, credit/debit, category, bank payout fields)
  - `notification.py`: Notification (title/body/category/data JSON/read_at)
  - `ticket.py`: SupportTicket, SupportMessage (status/priority, is_agent)
  - `pricing.py`: PricingRule (base_fare/per_km/per_minute/min_fare/night_multiplier/surge, city nullable = nationwide)
  - `coupon.py`: Coupon, CouponRedemption (percent|fixed, validity, max_uses, used_count)
  - `audit.py`: AuditLog (actor/action/entity/meta JSON/ip)
- `main.py` lifespan: idempotent ALTERs for new User/DriverProfile columns + seeds PricingRule rows mirroring old FARE_CONFIG (car 500/220/35 min 700; keke 200/120/20 min 300).
- Verified: 21 tables in `test_db`, pricing seeded, 23/23 ride tests pass.

## Stage 3 — Configurable DB-backed pricing (DONE)
- `services/pricing.py` rewritten: removed static `FARE_CONFIG`; `compute_fare` is now async and reads `pricing_rules` (city-specific rules take precedence over nationwide `city=NULL`; falls back to static defaults if table empty).
- Added night multiplier (applied 20:00–05:00), surge multiplier, and `min_fare` (max() guard) — all from the PricingRule row.
- Rides router call sites updated to `await compute_fare(db_sess, ...)`.
- Fare math stays identical to legacy for same inputs (verified: car 7.1km/24min → ₦2910 live; unit checks keke min-fare 300 + night same when rule multiplier=1).

## Stage 4 — Delivery/dispatch service (DONE)
- Seeded `delivery` (+ `moving`) pricing rules; seed now idempotently upserts missing vehicle types.
- `core/realtime.py`: added generic `broadcast_job_request(payload, lat, lng, max_km, vehicle_types)`; `broadcast_ride_request` delegates to it.
- `schemas/delivery.py`: quote/create/out/payment-method models.
- `services/delivery.py`: `quote_delivery_fee` (delivery pricing rule + ₦50/kg over 2kg surcharge), `delivery_out`, `load_delivery`.
- `routers/delivery.py`: `POST /api/delivery/quote`, `POST /api/delivery` (dispatch via WS to drivers within 15km), `GET /api/delivery?role=`, `GET /api/delivery/{id}`, accept/pickup/start/complete/cancel/payment-method.
- Lifecycle: requested → accepted → picked_up → in_transit → delivered (payment_status→paid, driver trips_completed++). WS events `delivery.request/accepted/status/completed/cancelled`.
- `tests/test_delivery_api.py`: 13 tests (quote, weight surcharge, full lifecycle, cancel rules, payment-method). Full suite: 36 passed.

## Stage 5 — House moving service (DONE)
- `schemas/moving.py`: quote/create/out/payment-method models (move_type, truck_size small|medium|large, move_date, items list).
- `services/moving.py`: `quote_moving_fee` (moving pricing rule base 3000/₦350km, min ₦10,000, truck_size multiplier 1.0/1.3/1.6), `moving_out`, `load_moving`.
- `routers/moving.py`: `POST /api/moving/quote` (eta = max(45, 2× ride time)), `POST /api/moving` (create + WS dispatch), `GET /api/moving?role=`, `GET /api/moving/{id}`, accept/start/complete/cancel/payment-method.
- Lifecycle: requested → accepted → in_progress → completed (paid, trips_completed++). WS events `moving.request/accepted/status/completed/cancelled`.
- `tests/test_moving_api.py`: 12 tests (quote min-fare, truck-size multiplier via Lagos→Ibadan route, full lifecycle, cancel rules). Full suite: 48 passed.

## Stage 6 — Driver verification (DONE)
- `config.py`: added `DEV_MODE` (true while default JWT secret used) guarding dev-only helpers.
- `core/deps.py`: added `require_admin` dependency (checks `is_admin`).
- `services/audit.py`: `log_audit(db, actor, action, entity_type, entity_id, meta, ip)` writes to `audit_logs` (verified working).
- `schemas/verification.py` + `services/verification.py`: submit/get/review models; `verification_out`/`admin_verification_out` (parse document_urls JSON).
- `routers/verification.py`:
  - `POST /api/drivers/verification` (driver submits ID + license + photos → `pending`)
  - `GET /api/drivers/verification` (own status)
  - `GET /api/admin/drivers/verifications?status=` (admin review queue)
  - `POST /api/admin/drivers/{id}/verify` (approve/reject + audit log + WS `verification.result`)
  - `POST /api/auth/dev/make-admin` (dev-only, 404 when real secret set)
- Business rule: `POST /api/drivers/status` blocks going online unless `verification_status == "verified"`.
- Tests: `tests/test_verification_api.py` (10 tests). Existing ride/delivery/moving fixtures now create verified drivers via shared `tests/conftest.py` helper `make_verified_online_driver` (register → submit → dev make-admin → admin verify → online). Full suite from `backend/`: **58 passed** (`cd backend && pytest tests -q`).

## Stage 7 — Wallet, earnings, payout, commission (DONE)
- `config.py`: `PLATFORM_COMMISSION_PERCENT = 15` (env-overridable).
- `services/wallet.py`: `get_or_create_wallet`, `credit`, `debit` (400 on insufficient balance), `driver_share(gross)` = gross × (100−commission)/100, `wallet_transactions`, `txn_out`. Credit/debit append `wallet_transactions` rows and are composed within the caller's transaction (single commit).
- `schemas/wallet.py`: Topup/Verify, WalletDetailOut (balance + txns), EarningsOut, WithdrawReq, WithdrawalOut, AdminWithdrawalReviewReq.
- `routers/wallet.py`:
  - `GET /api/wallet` (lazy wallet + last 50 txns)
  - `POST /api/wallet/topup` (Paystack init, dev fallback URL) + `POST /api/wallet/topup/verify` (idempotent, credits balance)
  - `GET /api/wallet/earnings` (driver net earnings + job_count + commission%)
  - `POST /api/wallet/withdraw` (requires balance ≥ amount, status pending) + `GET /api/wallet/withdrawals`
  - `GET /api/admin/withdrawals?status=` + `POST /api/admin/withdrawals/{id}/review` (approved|rejected|paid; paid debits wallet; audit-logged)
- Settlement wiring on job completion (all three routers): wallet-paid jobs debit the payer, every completed job credits driver earnings = `driver_share(fare)`. Insufficient balance blocks completion with 400 (ride stays `in_progress`).
- `schemas/rides.py`: `PaymentMethod` now includes `wallet`; estimate `payment_methods` list includes it.
- Tests: `tests/test_wallet_api.py` (14 tests: empty wallet, topup init/verify/idempotency, ride settlement both sides, earnings ledger, insufficient funds blocks completion, withdrawal lifecycle incl. admin approve→pay, non-admin 403). Full suite from `backend/`: **72 passed**.

## Stage 8 — Admin console in the Expo app (DONE)
- `frontend/src/lib/api.ts`: `User` now includes `is_admin`. Added `AdminVerification` + `Withdrawal` types and methods `adminVerifications(status?)`, `adminReviewVerification(user_id, decision, note?)`, `adminWithdrawals(status?)`, `adminReviewWithdrawal(request_id, decision, note?)`.
- `frontend/app/(tabs)/admin.tsx`: admin console with Verifications / Payouts segments, summary counts in hero, pull-style refresh button, `useFocusEffect` reload. Verifications cards show driver details + Approve/Reject (removes from queue). Payouts show pending (Approve/Reject) and approved (Mark as paid). Non-admins get an "Admin access only" guard screen.
- `frontend/app/(tabs)/_layout.tsx`: conditional Admin tab (`shield` icon) rendered only when `user.is_admin === 1`.
- Typecheck: `npx tsc --noEmit` clean. Backend suite still **72 passed** (unchanged this stage).

## Stage 9 — Notifications + Safety (DONE)
- `models/safety.py`: EmergencyRecord (status active|resolved, meta JSON), EmergencyContact, TripShare (12h token) + exports.
- `services/notifications.py`: `notify(db, user_id, title, body, category, data, push_token?)` — composes in-app row + best-effort Expo push (access token from config), returns after adding, caller commits.
- `schemas/safety.py` + `routers/notifications.py` (`GET /api/notifications?limit=`, `GET /api/notifications/unread-count`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`).
- `routers/safety.py`: `GET/POST /api/safety/contacts`, `DELETE /api/safety/contacts/{id}`, `POST /api/safety/emergency` (alerts ride counterpart via WS + audit `safety.emergency`), `POST /api/safety/emergency/{id}/resolve`, `GET /api/safety/emergency/my`, `POST /api/rides/{ride_id}/share` (12h token), `GET /api/rides/share/{token}` public view.
- Notifications wired (before commit — otherwise row never persists) into ride/delivery/moving accept+complete, verification result, withdrawal review.
- Tests: `tests/test_notifications_api.py` + `tests/test_safety_api.py`. Full suite: **95 passed**.

## Stage 10 — Coupons/promos (backend DONE)
- `models/coupon.py` extended: `audience` (rider|driver), `scope` (ride|delivery|moving|all); idempotent ALTERs in `main.py` lifespan.
- `services/coupons.py`: `coupon_out`, `redemption_out`, `discount_for` (percent|fixed + max_discount cap), `validate_rider_coupon` (404 unknown, 400 for inactive/wrong audience/wrong scope/not-started/expired/below min fare/usage limit/already-used/zero discount), `redeem` (bumps used_count + CouponRedemption row), `driver_bonus` (best active driver promo for scope, auto-redeems with `bonus_{scope}` entity id). Coupon validity compares with naive UTC now against naive columns.
- `schemas/coupons.py` + `routers/coupons.py`: `GET/POST /api/admin/coupons`, `POST /api/admin/coupons/{id}/toggle`, `GET /api/admin/coupons/{id}/redemptions`, `POST /api/coupons/validate`, `GET /api/coupons/my`.
- `coupon_code` added to RideRequestReq / DeliveryCreateReq / MovingCreateReq; all three create flows validate + apply discount + redeem before commit; all three completions credit `driver_share(fare) + driver_bonus`.
- Tests: `tests/test_coupons_api.py` (15: admin CRUD + toggle, rider validation incl. wrong scope/min fare, single-use enforcement, driver bonus stacking, unknown code 404, and a final test that DEACTIVATES the global driver promo so later test files (wallet) see clean earnings).
- Note: global driver promos are cross-test state — a leftover active promo causes wallet settlement assertions to fail (+500 bonus). Fixed by deactivating at end of coupon tests. Full suite: **110 passed**.

## Stage 10 frontend — Promos admin + coupon input (DONE)
- `frontend/src/lib/api.ts`: added `Coupon`, `CouponCreate`, `CouponRedemption`, `CouponValidateOut` types + methods `adminCoupons`, `adminCreateCoupon`, `adminToggleCoupon`, `adminCouponRedemptions`, `validateCoupon`, `myCoupons`; `requestRide` body now accepts `coupon_code`.
- `frontend/app/(tabs)/admin.tsx`: third segment **Promos** — active count badge, "New promo" inline form (code/description, audience rider|driver, scope ride|delivery|moving|all, discount type percent|fixed, value, min fare, max discount, max uses; defaults valid now→+30d), promo cards with audience icon (driver=car-sport), discount/scope/validity/usage rows, Pause/Activate toggle, expandable Usage list (redemptions).
- `frontend/app/(tabs)/ride.tsx`: "Promo code" section in the book form — input + Apply calls `validateCoupon(code, "ride", estimate.fare)`, shows applied state with Remove, error text on failure; applied discount shows strikethrough original fare + discounted `fare_after` in the estimate card; `coupon_code` sent to `requestRide` (backend stores discounted fare as `fare_estimate`). Coupon cleared on pickup/dropoff/vehicle change.
- Typecheck: `npx tsc --noEmit` clean. Backend suite: **110 passed** (unchanged).
- Note: delivery/moving have no frontend create screens yet (home cards `route: null`), so coupon input only wired into rides so far.

## Stage 16 — Referral program (DONE)
- `config.py`: `REFERRAL_REFERRER_REWARD = 500`, `REFERRAL_REFERRED_REWARD = 300` (env-overridable, ₦ wallet credits).
- `models/user.py`: `User.referral_code` (VARCHAR 12, index) + `referred_by` (VARCHAR 50, index); idempotent ALTERs + Python backfill (unique random 8-char codes) in lifespan for pre-existing users.
- `services/referrals.py`: `generate_referral_code` (unique 8-char uppercase alnum), `assign_referral_code` (lazy for legacy rows), `apply_referral` (400 already-referred / own code, 404 unknown; sets `referred_by`, credits both wallets with `ref_{user_id}` reference, notifications `referral` category, audit `referral.applied` — all composed in caller's transaction), `referrals_out` (code, `referral_link`, referrals list from `referred_by`, `total_rewards` from referral credits).
- `schemas/referrals.py` + `routers/referrals.py`: `GET /api/referrals`, `POST /api/referrals/apply` (registered in `main.py`).
- Auth: `RegisterReq.referral_code` optional + wired into register (apply before commit); google-session new users get codes; `UserOut` now includes `referral_code`.
- Frontend: `api.ts` `User.referral_code` + `ReferralOut`/`ReferralApplyOut` types + `myReferrals`/`applyReferral`; `api.register` accepts referral_code; `register.tsx` optional "Referral code" field; `profile.tsx` green "Invite friends" card (code + joined count + Share sheet), fetches `/api/referrals` on focus.
- Tests: `tests/test_referrals_api.py` (8 tests). Full suite: **118 passed**. Typecheck: clean.

## Stage 17 — Notifications + Safety frontend slice (DONE)
- Backend already had the endpoints (Stage 9): `GET/POST /api/notifications*`, `/api/safety/contacts`, `/api/safety/emergency*`, `POST /api/rides/{id}/share`, `GET /api/rides/share/{token}`.
- `api.ts`: added `Notification`, `EmergencyContact`, `EmergencyRecord`, `TripShareOut` types + methods `myNotifications`, `unreadCount`, `markNotificationRead`, `markAllNotificationsRead`, `emergencyContacts`, `addEmergencyContact`, `removeEmergencyContact`, `raiseEmergency`, `resolveEmergency`, `myEmergencies`, `shareRide`.
- New screens (auto-discovered root-stack routes, custom back headers):
  - `app/notifications.tsx` — inbox with unread highlight, tap-to-read, mark-all-read, pull-to-refresh, category icons + relative timestamps.
  - `app/safety.tsx` — big SOS button (confirm → `raiseEmergency`, shows "SOS raised"), trusted contacts add/remove, SOS history with "I'm safe" resolve.
- Home screen: bell icon top-right with unread-count badge → `/notifications`.
- Profile: Account section now has working "Notifications" and "Safety & SOS" links; wallet/verification stay "Soon".
- Ride active screen: "Share trip" (share sheet with track link via `shareRide`) + "SOS" (with ride_id) buttons once a driver is assigned.
- Drive screen: "SOS" button on the active ride card.
- Typecheck: clean. Smoke-tested register → unread-count → add contact → raise emergency against live server (all 200).

## Stage 18 — Ride chat + live map tracking (DONE)
- Backend chat:
  - `models/chat.py`: `Message` (`chat_messages`, autoincrement `id` PK + `message_id` unique; idempotent `ALTER ... ADD COLUMN IF NOT EXISTS id BIGINT NOT NULL AUTO_INCREMENT UNIQUE` in lifespan for the pre-existing dev table). Ordering by `id` avoids same-second tie issues.
  - `schemas/chat.py` (`MessageReq`/`MessageOut`), `services/chat.py` (`message_out`, `other_party`, `assert_ride_party` → 403, `send_message` persists + live-pushes, `ride_messages`).
  - `routers/chat.py`: `GET /api/rides/{ride_id}/messages` + `POST /api/rides/{ride_id}/messages`.
  - Realtime: new `/api/ws/chat` websocket + `chat` message type handled in the existing rides WS too. `ConnectionManager` gained `chat_clients` + `send_to_chat`. `send_message` pushes `chat.message` to the recipient's rides WS AND chat WS.
  - **Gotcha found**: `ws.send_json` can't serialize Python `datetime` → `message_out` returns `created_at.isoformat()` (WS pushes were silently failing before this). Also caused by a botched edit that merged two lines in `core/realtime.py` and took the dev server down until fixed.
  - Tests: `tests/test_chat_api.py` (8 tests: history, 403 for strangers, auth required, rider→driver, driver→rider, empty body 400, unknown ride 404). Full suite: **126 passed**.
- Frontend:
  - `api.ts`: `ChatMessage` type, `chatMessages`, `sendChatMessage`, `chatWsUrl()` helper.
  - `app/chat.tsx`: live chat screen (REST history + optimistic append on send, `/api/ws/chat` socket for incoming `chat.message`, dedupe by `message_id`, own bubbles right / other left, KeyboardAvoidingView composer).
  - `src/components/live-map.tsx`: `react-native-maps` via dynamic import (native only; graceful coordinate-card fallback on web). Markers for driver (blue), pickup (green), dropoff (red); auto-computed center/span.
  - Ride screen: live map under the hero (driver dot follows WS `driver.location`), action row now Chat / Share / SOS.
  - Drive screen: map + "Message rider" button on the active ride card; SOS stays.
- Lint: 0 errors (1 pre-existing `ROUTES_CACHE_KEY` unused warning). Typecheck: clean. Live WS smoke test: rider↔driver chat delivered both ways.

## Stage 19a — Google-Maps-style ride booking (OSM search + tap map) (DONE)
- Backend `routers/places.py` — OpenStreetMap **Nominatim** proxy, registered in `main.py`:
  - `GET /api/places/search?q=...&limit=` → forwards to `https://nominatim.openstreetmap.org/search` (`format=jsonv2`, `addressdetails=1`) with a proper `User-Agent`; returns `{name, lat, lng, city, category}`.
  - `GET /api/places/reverse?lat=&lng=` → Nominatim `/reverse` (zoom 17), same shape. Both 502 on upstream failure, 404 if nothing found.
  - Verified live: `search q=lekki phase 1` and reverse of 6.4534/3.3942 both return real OSM data.
- Frontend:
  - `api.ts`: `Place` type + `searchPlaces(q)` / `reverseGeocode(lat,lng)`.
  - `src/components/place-autocomplete.tsx`: debounced (350ms) search input, dropdown of up to 8 suggestions, spinner, clear button, "no results" state. Accepts `style` for z-index stacking.
  - `src/components/booking-map.tsx`: interactive map (`react-native-maps` via dynamic import, coordinate-card web fallback) — pickup (green) + dropoff (red) pins, tap-to-set-destination, locate button (spinner while locating), auto center/span on the selected points.
  - `app/(tabs)/ride.tsx` form phase rebuilt map-first: full-width interactive map on top, pickup + dropoff search inputs, swap button, GPS "locate me" pill, tap-map-pin as dropoff (background reverse-geocode names the pin), tip line. Vehicle/fare/payment/coupon/request flow unchanged and still wired to chosen lat/lng + place names. `requestRide` now sends `pickup_address`/`dropoff_address` from the chosen places.
- **Lint gotcha**: naming a callback `useMyLocation` trips `react-hooks/rules-of-hooks` (any `use*` name is treated as a hook) → renamed to `getMyLocation`.
- Typecheck clean, eslint 0 errors (2 pre-existing warnings: `ROUTES_CACHE_KEY`, mount-effect deps). Backend suite still **126 passed**.
- Notes: Nominatim is free but rate-limited (~1 req/s) and requires attribution — proxy centralizes it and keeps it off the device.

## Stage 19b — Driver dispatch + live Google-Maps-style ETA countdown (DONE)
- **How dispatch works** (explained to user): rider `POST /api/rides` → ride row `status=requested` + `driver_eta_minutes` from `nearest_driver_eta`; backend `broadcast_ride_request` pushes `ride.request` over `/api/ws/rides` to online drivers of that `vehicle_type` within 15km (WS `driver_meta` holds vehicle_type+coords). Driver taps Accept → `POST /rides/{id}/accept` (atomic CAS on `status=requested`) → rider gets `ride.status` + full `ride.accepted` payload. Driver then streams `{type:location}` every ~10s; the rider's map dot follows.
- Driver registration already collects name (account) + vehicle type + **plate + model (car name) + colour + phone** (`POST /drivers/register`, `routers/drivers.py`); `profile_photo` captured during verification.
- `DriverOut`/`DriverProfileOut` + all three payload builders (`ride_out`, `delivery_out`, `moving_out`, `driver_profile_out`) now expose **`profile_photo`** so the rider sees the driver's picture.
- **Live ETA** (`routers/realtime.py`, driver `location` branch): reads the driver's active jobs in a **short-lived session** and computes `eta_minutes_between(driver, target)` (`core/geo.py` helper, road distance/24kph, min 1). Pushes:
  - rider/customer: `driver.location` with `eta_minutes` + `target: pickup|dropoff` — pickup while en route (accepted/arriving), dropoff while driving (in_progress).
  - driver: `driver.eta` (same fields + job id) for their own countdown.
  - Delivery (accepted→pickup; picked_up/in_transit→dropoff) and Moving (accepted→origin; in_progress→destination) get the identical treatment.
- **Bug 1 (pre-existing, broke `ride.accepted`)**: `ws.send_json` couldn't serialize `datetime` **or embedded pydantic `DriverOut`** — the accepted push failed silently and disconnected the rider, which is why the app relied on REST refetch. Fixed systemically in `core/realtime.py` with `_json_safe()` (recursively converts pydantic models → dict, datetime/date → isoformat) applied in every `send_to_*`.
- **Bug 2**: the connection-scoped WS session held a stale MySQL REPEATABLE READ snapshot, so `in_progress` rides still got `target=pickup`. Fixed by reading active jobs in a fresh `AsyncSessionLocal()` per location message.
- Frontend:
  - `api.ts`: `profile_photo` on `DriverProfile` + `RideOut.driver`; new `DriverEta` type; `driver.location` now carries optional `eta_minutes`/`target`; new `driver.eta` event variant.
  - `ride.tsx`: driver card shows **photo** (Image w/ avatar fallback) + car name · colour · plate; new **ETA banner** ("Driver is on the way ~X min" → "Arriving at dropoff ~X min") seeded from `driver_eta_minutes`, live-updated from each `driver.location` push.
  - `drive.tsx`: live **"Pickup in ~X min / Dropoff in ~X min"** banner fed by `driver.eta` (filtered by `rideIdRef` since `onmessage` closures are stale); reset on accept/start/complete/offline.
- Verified: WS smoke test (rider+driver sockets) — pickup ETA `target=pickup` 6min, driver got `driver.eta`, after start `target=dropoff` 18min. Typecheck clean, eslint 0 errors (2 pre-existing warnings), backend suite **126 passed**.
- Note: delivery/moving backend now streams live ETA + driver payload, but their customer/driver **screens are still not built** in the Expo app (home shows "coming soon").

## Stage 19c — Separate driver/user dashboards + state picker at registration (DONE)
- **Role-gated dashboards** (`app/(tabs)/_layout.tsx`): riders see Map/Ride/Profile, drivers see Map/Drive/Profile. IMPORTANT: this expo-router version renders ALL file routes in the tab bar regardless of conditional `<Tabs.Screen>` — hiding is done via `href: null` (keeps the route deep-linkable), NOT by omitting the screen.
- `User.role` (`user | driver | admin`) was already in the schema but never set — `POST /drivers/register` now flips `role="driver"`; lifespan backfills existing driver-profile users (`UPDATE users SET role='driver' WHERE user_id IN (SELECT user_id FROM driver_profiles)`).
- **Landing split** (`app/_layout.tsx` NavGuard): after auth, drivers → `/(tabs)/drive`, riders → `/(tabs)/ride` (which auto-requests location and prefills pickup).
- **State at registration**: `User.state` column (lifespan ALTER + model), `RegisterReq.state` + `UserOut.state` (also surfaced via `/auth/me`), register stores it. Frontend `register.tsx` has a modal state picker (36 states + FCT, no new deps); `api.register`/`signUp` take `state`; after signup redirects to `/(tabs)/ride`.
- Profile screen: state chip in header + role-switch entries — riders get **"Become a driver"** (→ `/(tabs)/drive`), drivers get **"Ride as passenger"** (→ `/(tabs)/ride`); drive.tsx calls `await refresh()` after driver register so the tab bar swaps immediately.
- Verified: `/api/auth/register` returns `role:"user", state:"Lagos"`; `/auth/me` returns both; after `POST /drivers/register` role becomes `"driver"`. Backend suite **126 passed**, tsc clean, eslint 0 errors (2 pre-existing warnings).

## Stage 19d — Delete account (backend + UI) + Expo/Metro fix (DONE)
- User reported "can't see it in the UI": **two stale Metro/Expo processes were fighting over port 8081** (one from Friday). Killed all (PIDs via `ps aux | grep expo`, `lsof -i :8081`), restarted ONE clean instance `npx expo start --host lan --clear` (log `/tmp/naija-ride-expo.log`), warmed the bundle via the manifest's `launchAsset` URL (HTTP 200, 7.4MB). To update Expo Go: reload the app.
- **Delete account feature**:
  - Backend `DELETE /api/auth/account` (`routers/auth.py`): requires password for password-provider users (`verify_pw`), blocks admins, then deletes the user's sessions, device tokens, password resets, driver profile, notifications, support tickets+messages, wallet+transactions+withdrawals, coupon redemptions, emergency records/contacts/trip shares, chat messages (sender OR recipient), nulls out `users.referred_by` for anyone they referred, then deletes the user row. No FK constraints in the schema, so plain deletes are safe. Logs `Account deleted: <email> (<id>)`.
  - Frontend: `api.deleteAccount(password?)` (DELETE w/ body); `auth.tsx` exposes `deleteAccount` on the context (calls API, clears token+user → NavGuard sends to onboarding); `profile.tsx` adds a red **"Delete account"** row + confirmation modal with password field (hidden for Google users), error display, busy state. After success the user is logged out and lands on onboarding.
- Verified: wrong password → 400; correct → `{ok:true}`; token invalid afterwards. Backend **126 passed**, tsc clean, eslint 0 errors (2 pre-existing warnings: `ROUTES_CACHE_KEY`, ride.tsx mount-effect dep).

## Next steps (roadmap)
1-9. (done) Stages 1-9, Stage 10, Stage 16 (referral), Stage 17 (notifications/safety UI), Stage 18 (chat + live map), Stage 19a (OSM search + tap-map booking), Stage 19b (driver dispatch + live ETA), Stage 19c (driver/user dashboards + state picker), Stage 19d (delete account + Metro fix) done
19. Stage 19e: support tickets API + UI + push-token registration
20. Stage 20: admin analytics dashboard
21. Stage 21: bookings/scheduling, multi-stop trips, or Paystack hardening

## API surface (live)
`/api/auth/*`, `/api/drivers/*`, `/api/zones`, `/api/rides` + lifecycle actions, `/api/rides/estimate`, `/api/payments/*`, `/api/trips/{id}/rate`, `/api/ws/rides` (role=driver|rider), `/api/ws/chat`, `/api/me/push-token`, `/api/notifications`, `/api/safety/*`, `/api/rides/share/{token}`, `/api/admin/coupons`, `/api/coupons/*`, `/api/places/search`, `/api/places/reverse`
