"""Centralised configuration. Every secret lives here, sourced from env vars."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

DB_URL = os.environ.get("DB_URL", "mysql+asyncmy://root:root1234@localhost/test_db")

# Connection pool sizing (scalability: raise these for heavier load).
DB_ECHO = os.environ.get("DB_ECHO", "0") == "1"
DB_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", 10))
DB_MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", 20))
DB_POOL_RECYCLE = int(os.environ.get("DB_POOL_RECYCLE", 1800))

# Observability.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
LOG_DIR = Path(os.environ.get("LOG_DIR", str(ROOT_DIR / "logs")))
LOG_FILE_MAX_BYTES = int(os.environ.get("LOG_FILE_MAX_BYTES", 5 * 1024 * 1024))
LOG_FILE_BACKUPS = int(os.environ.get("LOG_FILE_BACKUPS", 5))

# Caching TTLs (seconds) for hot, read-heavy data.
CACHE_TTL_ZONES = int(os.environ.get("CACHE_TTL_ZONES", 60))
CACHE_TTL_PRICING = int(os.environ.get("CACHE_TTL_PRICING", 60))
CACHE_TTL_PLACES = int(os.environ.get("CACHE_TTL_PLACES", 600))

# If "1", the /api/monitoring/logs endpoint (tail of the app log) is reachable
# by admins. Disabled by default for production safety.
MONITORING_EXPOSE_LOGS = os.environ.get("MONITORING_EXPOSE_LOGS", "0") == "1"

# JWT config (dev secret - rotate in prod via JWT_SECRET env var)
JWT_SECRET = os.environ.get("JWT_SECRET", "transport-tracker-dev-secret-change-me-2026")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 7

# Dev mode is active while the default secret is in use. Guards dev-only helpers
# (e.g. /auth/dev/make-admin) so they vanish once a real secret is set.
DEV_MODE = JWT_SECRET == "transport-tracker-dev-secret-change-me-2026"

# Payment providers (secrets never shipped to the frontend)
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")

# Driver payout economics: % of each completed job taken by the platform.
PLATFORM_COMMISSION_PERCENT = int(os.environ.get("PLATFORM_COMMISSION_PERCENT", 15))

# Referral rewards (₦ credited to wallets when a new rider joins with an invite code).
REFERRAL_REFERRER_REWARD = int(os.environ.get("REFERRAL_REFERRER_REWARD", 500))
REFERRAL_REFERRED_REWARD = int(os.environ.get("REFERRAL_REFERRED_REWARD", 300))

# Expo push (optional; the legacy push endpoint works without a token).
EXPO_PUSH_ACCESS_TOKEN = os.environ.get("EXPO_PUSH_ACCESS_TOKEN", "")

# Base URL used to build shareable trip links.
SHARE_BASE_URL = os.environ.get("SHARE_BASE_URL", "http://localhost:8001")
