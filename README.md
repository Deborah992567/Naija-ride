# Naija Ride

A full-stack, crowdsourced ride-hailing and transport platform built for Nigerian cities. Naija Ride connects riders, drivers, and delivery/moving services in one app — with live vehicle tracking, transparent pricing, wallets, and community-sourced reporting.

## 🚀 Features

### Ride Hailing
- **Book a ride**: Request a car instantly, get fare estimates, and track your driver live on the map.
- **Driver mode**: Drivers can go online, accept booking requests, and manage their trips.
- **Live tracking**: Real-time vehicle location via WebSockets.
- **Zones**: City zones with per-vehicle-type restrictions (e.g. bikes banned in Wuse, Abuja).
- **Pricing engine**: DB-backed pricing rules (base fare, per-km, per-minute, minimum fare) configurable by an admin.

### Delivery & Moving
- **Delivery**: Send packages with fare estimates and live tracking.
- **Moving**: Book moving/relocation services with distance-based pricing.

### Payments & Wallet
- **Wallet**: Fund, withdraw, and pay for rides in-app.
- **Payments**: Secure payment processing tied to rides, delivery, and moving.
- **Coupons & Promotions**: Rider/driver targeted discounts with scoped validity.
- **Referrals**: Share your referral code and earn rewards.

### Community & Safety
- **Ratings**: Rate drivers and rides after every trip.
- **Safety features**: Trust & safety flows for both riders and drivers.
- **Driver verification**: Document upload and KYC-style verification workflow.
- **In-app chat**: Chat between riders and drivers for each trip.
- **Support tickets**: In-app support ticket system.

### Platform
- **Push notifications**: Real-time alerts via Expo notifications.
- **Admin panel**: Manage pricing rules, zones, users, and platform operations.
- **Multi-city**: Seeded for Lagos, Abuja, and Port Harcourt.
- **Hybrid auth**: Email/password (JWT) with Google OAuth via Emergent session integration.
- **AI assistant**: `POST /api/assistant/message` answers support questions via an
  OpenAI-compatible API, with an offline FAQ fallback when `AI_API_KEY` is unset.
- **Data portability**: `GET /api/auth/export-data` returns every record held about a
  user (NDPR/GDPR compliant export).

### Security
- **Rate limiting**: Per-IP sliding window on all endpoints, stricter on auth
  (login/register) and places; returns `429` + `Retry-After`.
- **CORS**: Restricted to a configurable `ALLOWED_ORIGINS` allow-list.
- **Password policy**: Minimum length + required digit enforced at signup/reset.
- **Upload validation**: Magic-byte sniffing rejects disguised executables.
- **Request timeouts**: Every request is bounded — slow handlers return `504` instead
  of wedging a worker.

### Reliability
- **Retry with backoff + circuit breaker**: Outbound calls (Paystack, Nominatim,
  Emergent, AI) retry transient failures with exponential backoff; a per-host circuit
  breaker trips open after repeated failures so an upstream outage can't take the API down.
- **Health checks**: `GET /api/health/live` (liveness) and `/api/health/ready`
  (DB readiness probe) for orchestrators and load balancers.
- **DB indexes**: Composite/hot-path indexes applied at startup for rides, wallet
  transactions, delivery, and moving lookups.
- **Automated backups**: `scripts/backup_db.sh` dumps MariaDB daily (cron) with
  retention pruning.

### Performance
- **GZip compression**: Enabled via middleware for JSON payloads.
- **N+1 elimination**: Ride-list endpoint batch-loads driver profiles/names in 2
  queries instead of 1 per ride.
- **Caching**: See below — plus a dedicated cache stats endpoint.

### Observability, Caching & Scalability
- **Structured JSON logs**: One rotating log file (`backend/logs/app.log`) with
  request latency, status, request IDs, and per-domain business events —
  every signup, login, ride, delivery, moving job, payment, and wallet movement.
- **Latency tracking**: Every HTTP request is timed and recorded (avg latency,
  per-route counters, and a latency histogram) via the monitoring endpoint.
- **Monitoring API**: `GET /api/monitoring/metrics`, `/api/monitoring/cache`,
  and (admins only) `/api/monitoring/logs`.
- **Caching**: In-memory TTL cache for hot data — zone rules, fare rules, and
  Nominatim place lookups — slashing DB hits and upstream API calls.
- **Scalability**: Configurable DB connection pooling (`pool_size`,
  `max_overflow`, `pool_recycle`, `pool_pre_ping`) so the API handles
  concurrent riders/drivers without re-opening connections.

### Developer Tooling & CI
- **Linting**: `ruff` configured in `backend/pyproject.toml` (pyflakes rules),
  run in CI and via `ruff check backend/app`.
- **Load testing**: Locust scenarios in `backend/load_testing/locustfile.py`
  (rider + driver flows).
- **Dependabot**: Weekly dependency update PRs for pip, npm, and GitHub Actions.
- **CI**: GitHub Actions runs ruff + the pytest suite on every push.

## 🛠 Tech Stack

### Backend
- **Framework**: FastAPI (Python)
- **Database**: MariaDB via SQLAlchemy 2.0 + `asyncmy` (fully async)
- **Auth**: JWT (PyJWT) + Google OAuth
- **Realtime**: WebSockets
- **Tests**: pytest (unit + E2E API tests)

### Frontend
- **Framework**: Expo (React Native) with Expo Router
- **Maps**: MapLibre React Native
- **Storage**: AsyncStorage + SecureStore
- **Notifications**: expo-notifications
- **Auth session**: Emergent session integration

## 📦 Getting Started

### Prerequisites
- Python 3.12+
- Node.js & npm / Yarn
- MariaDB 11.4 (or Docker)

### Option A: Docker (recommended)
The repo ships a `docker-compose.yml` that brings up MariaDB and the backend together:

```bash
docker compose up --build
```

The backend will be available at `http://localhost:8001`.

### Option B: Manual backend setup
1. Navigate to the backend directory and install dependencies:
   ```bash
   cd backend
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env`:
   ```dotenv
   DB_URL="mysql+asyncmy://root:root1234@localhost/test_db"
   JWT_SECRET="your-secret-key"
   ```
3. Run the API server:
   ```bash
   uvicorn app.main:app --reload --port 8001
   ```

### Frontend setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   npm install   # or: yarn
   ```
2. Configure the backend URL:
   ```bash
   cp .env.example .env
   ```
   ```dotenv
   EXPO_PUBLIC_BACKEND_URL=http://<your-local-ip>:8001
   ```
3. Start the Expo dev server:
   ```bash
   npx expo start
   ```

## 🧪 Testing

Run the backend test suite (pytest):

```bash
cd backend
pytest -v
```

## 📊 Monitoring & Logs

The backend exposes three monitoring endpoints (add an admin Bearer token for `/logs`):

| Endpoint | Description |
| --- | --- |
| `GET /api/monitoring/metrics` | Request counters, avg latency, latency histogram, slowest requests, error rate |
| `GET /api/monitoring/cache` | Cache hit/miss rate and current size |
| `GET /api/monitoring/logs` | Tail of the structured app log (requires `MONITORING_EXPOSE_LOGS=1` + admin token) |

Every request writes a structured JSON access log, and every domain action emits
a business event. Example:

```json
{"ts":"2026-08-02T19:41:22.798","level":"INFO","logger":"naija-ride.events",
 "msg":"auth.user.signup","scope":"auth","event":"user.signup","user_id":"user_6da14a68d949"}
{"ts":"2026-08-02T19:41:23.191","level":"INFO","logger":"naija-ride.access",
 "msg":"request","request_id":"09920c744ef146eb","duration_ms":378.454,
 "method":"POST","path":"/api/auth/login","status_code":200}
```

Business events cover `auth` (signup, login, login_failed, logout, google_login,
password_reset, account_deleted), `rides` (estimate, requested, accepted,
cancelled, started, completed, rated), `drivers` (registered, online, offline),
`delivery`, `moving`, `wallet` (credit, debit, topup, withdrawal), `payments`,
and `referrals`.

### Scaling for production

- **More workers**: run multiple Uvicorn workers behind a load balancer:
  `uvicorn app.main:app --workers 4` (each worker gets its own in-memory cache).
- **Connection pool**: tune `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` to your DB's
  connection limit.
- **Shared cache**: the in-process cache is per instance — for multi-instance
  deployments, back `core/cache.py` with Redis (the `get/set/delete/clear` API
  is designed to be swapped without touching call sites).
- **Log shipping**: stream `backend/logs/app.log` to Datadog/Loki/CloudWatch.

### Reliability operations

- **Health checks**: point your load balancer at `/api/health/ready` (DB-backed)
  and `/api/health/live` for process liveness.
- **Backups**: run `scripts/backup_db.sh` on a schedule:
  ```bash
  cd backend
  ./scripts/backup_db.sh            # dumps to backend/backups/, prunes after 14 days
  ```
- **Outbound resilience**: circuit breakers trip per upstream host; failures and
  re-trips are logged via `core/http.py`.

### AI assistant

`POST /api/assistant/message` with a Bearer token and `{"message": "..."}`. When
`AI_API_KEY` is set it calls `AI_BASE_URL/chat/completions` (any OpenAI-compatible
endpoint). With no key it falls back to an offline FAQ matcher that answers from
live user data (wallet balance, recent ride status, driving, pricing, promos).

### Load testing

```bash
cd backend
pip install -r requirements-dev.txt
locust -f load_testing/locustfile.py --host http://localhost:8001
```

### Linting

```bash
cd backend
pip install -r requirements-dev.txt
ruff check app/
```

## 📄 API Documentation

Once the backend is running, the interactive Swagger UI is available at:
`http://localhost:8001/docs`

## 📁 Project Structure

```
├── backend/            # FastAPI application
│   ├── app/
│   │   ├── core/       # deps, security, geo, http (retry/circuit), realtime, logging, cache, monitoring
│   │   ├── models/     # SQLAlchemy models
│   │   ├── routers/    # API route modules (incl. monitoring, health, assistant)
│   │   ├── schemas/    # Pydantic schemas
│   │   ├── services/   # Business logic (incl. assistant)
│   │   └── main.py     # App entrypoint
│   ├── scripts/        # backup_db.sh (MariaDB backups)
│   ├── load_testing/   # Locust scenarios
│   ├── logs/           # Structured JSON logs (rotating)
│   └── tests/          # pytest suite
├── frontend/           # Expo (React Native) app
│   ├── app/            # Expo Router screens
│   ├── src/            # Components, hooks, lib, utils
│   └── package.json
├── .github/            # CI workflow + Dependabot config
└── docker-compose.yml  # MariaDB + backend orchestration
```

## 📜 License

This project is private and not licensed for public use.
