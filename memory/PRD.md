# Public Transport Tracker (NaijaMove) — PRD

## Problem
People in Lagos, Abuja, Port Harcourt and on university campuses waste time waiting for buses, danfo, keke, and shuttles with no idea when the next vehicle will arrive.

## Solution
A crowdsourced mobile app where riders share live vehicle locations, crowding levels, delays and fare changes, so everyone benefits from real-time arrival estimates.

## Tech Stack
- **Mobile**: Expo Router (SDK 54) + React Native + `react-native-maps` (Google/Apple defaults); web fallback shows a stylized canvas with markers.
- **Backend**: FastAPI + MongoDB (Motor) + JWT + bcrypt.
- **Auth**: Email/password (JWT) **and** Emergent Google Auth — share `users` collection.

## Core Features
1. **Live Map** (Map tab) — sticky search + vehicle-type chips, real-time vehicle markers, route polylines, ETA pill, FAB to report. Auto-refresh every 15 s.
2. **Routes Browser** (Routes tab) — search/filter by city (Lagos/Abuja/Port Harcourt/Campus), tap to see stops + per-stop ETAs.
3. **Route Detail** — timeline of stops with computed ETA badge (high/medium/low confidence based on freshness of crowdsourced reports), recent activity feed.
4. **Report Flow** (Report tab) — pick type (sighting / on-board / delay / fare), pick route, set crowd level, optional note, submit. Uses device GPS (with permission flow) or route stop as fallback.
5. **Profile** — avatar, karma counter (+1 per report), recent reports list, sign-out.
6. **Onboarding** — 3-slide intro with localized imagery (Keke, Danfo, bus stops).

## ETA Algorithm
- Server-side. Uses most recent sighting/onboard report for the route.
- Haversine distance from vehicle to target stop ÷ vehicle-type-specific urban speed (22 km/h bus, 20 km/h danfo, 18 km/h keke, 25 km/h shuttle), minus minutes since report. Confidence ranks high/medium/low/none from report freshness + count.

## Seeded Routes
- Lagos: Yaba ↔ CMS (Danfo, ₦400)
- Abuja: Wuse ↔ Garki BRT (Bus, ₦250)
- Port Harcourt: Mile 1 ↔ Town (Keke, ₦200)
- UNILAG Campus Shuttle (₦100)

## Endpoints (all under `/api`)
- `POST /auth/register`, `POST /auth/login`, `POST /auth/google-session`, `GET /auth/me`, `POST /auth/logout`
- `GET /routes`, `POST /routes`, `GET /routes/{id}`
- `POST /reports`, `GET /reports`, `GET /vehicles/live`
- `GET /eta?route_id=&stop_id=`

## Brand
- Name: **NaijaMove**
- Primary: Nigerian Green (`#008751`) · Accent: Danfo Yellow (`#FFCC00`)
- Type: Outfit (headings) / Manrope (body)
