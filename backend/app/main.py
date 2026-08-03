"""Naija Ride API — application entrypoint.

Assembles the modular FastAPI app: routers, lifespan (schema + seed), CORS.
"""
import logging
import random
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import func, select
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles

from .config import ALLOWED_ORIGINS, ROOT_DIR
from .core.logging import LatencyMiddleware, configure_logging
from .core.security import SecurityHeadersMiddleware
from .db import AsyncSessionLocal, Base, engine
from .models import PricingRule, User, ZoneRule
from .routers import (
    admin,
    assistant,
    auth,
    chat,
    coupons,
    delivery,
    drivers,
    health,
    monitoring,
    moving,
    notifications,
    payments,
    places,
    realtime,
    referrals,
    rides,
    safety,
    tickets,
    upload,
    verification,
    wallet,
    zones,
)
from .services.referrals import generate_referral_code

configure_logging()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("naija-ride")

# Zones where specific vehicle types are restricted (e.g. bikes banned in Wuse, Abuja).
SEED_ZONES = [
    {
        "zone_id": f"z_{uuid.uuid4().hex[:10]}",
        "city": "Abuja",
        "zone_name": "Wuse",
        "lat": 9.0765,
        "lng": 7.4750,
        "radius_km": 3.0,
        "disallowed_vehicle_types": "bike",
    },
    {
        "zone_id": f"z_{uuid.uuid4().hex[:10]}",
        "city": "Abuja",
        "zone_name": "Central Business District",
        "lat": 9.0579,
        "lng": 7.4951,
        "radius_km": 3.5,
        "disallowed_vehicle_types": "bike",
    },
    {
        "zone_id": f"z_{uuid.uuid4().hex[:10]}",
        "city": "Lagos",
        "zone_name": "Third Mainland Bridge",
        "lat": 6.5044,
        "lng": 3.3849,
        "radius_km": 2.0,
        "disallowed_vehicle_types": "bike",
    },
]

# Default pricing rules (mirror the legacy static FARE_CONFIG). The pricing
# engine reads this table (Stage 3); admin edits land here in Stage 8.
SEED_PRICING_RULES = [
    {"rule_id": f"pr_{uuid.uuid4().hex[:10]}", "vehicle_type": "car", "city": None,
     "base_fare": 500, "per_km": 220, "per_minute": 35, "min_fare": 700},
    {"rule_id": f"pr_{uuid.uuid4().hex[:10]}", "vehicle_type": "delivery", "city": None,
     "base_fare": 400, "per_km": 90, "per_minute": 0, "min_fare": 500},
    {"rule_id": f"pr_{uuid.uuid4().hex[:10]}", "vehicle_type": "moving", "city": None,
     "base_fare": 3000, "per_km": 350, "per_minute": 0, "min_fare": 10000},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent migrations + drop obsolete transport-tracker tables.
        for stmt in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INT DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'unverified'",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS id_type VARCHAR(30)",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS id_number VARCHAR(100)",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS license_number VARCHAR(100)",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS license_expiry DATE",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(255)",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS document_urls TEXT",
            "ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS verification_note VARCHAR(255)",
            "ALTER TABLE coupons ADD COLUMN IF NOT EXISTS audience VARCHAR(10) DEFAULT 'rider'",
            "ALTER TABLE coupons ADD COLUMN IF NOT EXISTS scope VARCHAR(20) DEFAULT 'ride'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by VARCHAR(50)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(50)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'",
            "UPDATE users SET role = 'driver' WHERE user_id IN (SELECT user_id FROM driver_profiles) AND role = 'user'",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS id BIGINT NOT NULL AUTO_INCREMENT UNIQUE",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS delivery_id VARCHAR(60)",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS moving_id VARCHAR(60)",
            "ALTER TABLE chat_messages MODIFY COLUMN ride_id VARCHAR(60) NULL",
            # Remove the retired "keke" vehicle type from existing data (keke drivers -> car, keke zone bans -> bike).
            "UPDATE driver_profiles SET vehicle_type = 'car' WHERE vehicle_type = 'keke'",
            "DELETE FROM pricing_rules WHERE vehicle_type = 'keke'",
            "UPDATE zone_rules SET disallowed_vehicle_types = REPLACE(disallowed_vehicle_types, 'keke', 'bike')",
            "DROP TABLE IF EXISTS reports",
            "DROP TABLE IF EXISTS route_follows",
            "DROP TABLE IF EXISTS routes",
            # Hot-query indexes (composites + status not covered by single-column model indexes).
            "CREATE INDEX IF NOT EXISTS idx_rides_status ON ride_requests (status)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_txn_user ON wallet_transactions (user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_txn_category ON wallet_transactions (user_id, category, status)",
        ]:
            await conn.exec_driver_sql(stmt)

    async with AsyncSessionLocal() as session:
        zone_count = (await session.execute(select(func.count()).select_from(ZoneRule))).scalar_one()
        if zone_count == 0:
            for z in SEED_ZONES:
                session.add(ZoneRule(**z))
            await session.commit()
            logger.info("Seeded zone rules")

        rule_count = (await session.execute(select(func.count()).select_from(PricingRule))).scalar_one()
        if rule_count == 0:
            for r in SEED_PRICING_RULES:
                session.add(PricingRule(**r))
            await session.commit()
            logger.info("Seeded pricing rules")
        else:
            # Idempotent upsert for newly added vehicle types (e.g. delivery).
            existing_types = set((await session.execute(select(PricingRule.vehicle_type))).scalars().all())
            added = False
            for r in SEED_PRICING_RULES:
                if r["vehicle_type"] not in existing_types:
                    session.add(PricingRule(**r))
                    added = True
            if added:
                await session.commit()
                logger.info("Seeded additional pricing rules")

        # Backfill referral codes for users created before the column existed.
        missing_res = await session.execute(select(User.user_id).where(User.referral_code.is_(None)))
        missing_ids = missing_res.scalars().all()
        if missing_ids:
            used = set((await session.execute(select(User.referral_code))).scalars().all())
            for uid in missing_ids:
                code = None
                for _ in range(10):
                    cand = await generate_referral_code(session)
                    if cand not in used:
                        code = cand
                        used.add(cand)
                        break
                if not code:
                    code = f"NR{random.randint(100000, 999999)}"
                row = await session.get(User, uid)
                if row:
                    row.referral_code = code
            await session.commit()
            logger.info("Backfilled referral codes for %d users", len(missing_ids))

    yield
    await engine.dispose()


app = FastAPI(title="Naija Ride API", version="1.0.0", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(drivers.router)
app.include_router(zones.router)
app.include_router(rides.router)
app.include_router(delivery.router)
app.include_router(moving.router)
app.include_router(verification.router)
app.include_router(payments.router)
app.include_router(wallet.router)
app.include_router(notifications.router)
app.include_router(safety.router)
app.include_router(coupons.router)
app.include_router(referrals.router)
app.include_router(chat.router)
app.include_router(places.router)
app.include_router(realtime.router)
app.include_router(tickets.router)
app.include_router(admin.router)
app.include_router(upload.router)
app.include_router(health.router)
app.include_router(monitoring.router)
app.include_router(assistant.router)

uploads_dir = ROOT_DIR / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Middleware order: last-added runs first (outermost).
# Outermost: latency/access logs, rate limiting, request timeout.
app.add_middleware(LatencyMiddleware)
# Security headers (CSP, nosniff, frame denial) on every response.
app.add_middleware(SecurityHeadersMiddleware)
# Compress JSON/text responses over the wire.
app.add_middleware(GZipMiddleware, minimum_size=1000)
# CORS restricted to the configured origins (see ALLOWED_ORIGINS env).
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def app_root():
    """Base root to provide information and prevent 404s for automated tools."""
    return {
        "name": "Naija Ride API",
        "status": "online",
        "api_docs": "/docs",
        "message": "This is the backend API. Use the Expo development server URL to load the mobile app.",
    }
