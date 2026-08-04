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

# --- Security ---------------------------------------------------------------
# CORS: comma-separated allowed origins. In production, list your app domains.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:19006,http://localhost:8081,http://127.0.0.1:19006,http://localhost:3000",
    ).split(",")
    if o.strip()
]

# Rate limiting (requests per minute per client IP).
RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "1") == "1"
RATE_LIMIT_GENERAL = int(os.environ.get("RATE_LIMIT_GENERAL", 300))
RATE_LIMIT_AUTH = int(os.environ.get("RATE_LIMIT_AUTH", 10))
RATE_LIMIT_PLACES = int(os.environ.get("RATE_LIMIT_PLACES", 20))
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", 60))
# Exempt loopback traffic so local development/test suites aren't throttled.
RATE_LIMIT_EXEMPT_LOCALHOST = os.environ.get("RATE_LIMIT_EXEMPT_LOCALHOST", "1") == "1"

# Password policy.
PASSWORD_MIN_LENGTH = int(os.environ.get("PASSWORD_MIN_LENGTH", 8))
PASSWORD_REQUIRE_DIGIT = os.environ.get("PASSWORD_REQUIRE_DIGIT", "1") == "1"

# AI assistant (optional). Leave AI_API_KEY empty to use the offline FAQ mode.
AI_ENABLED = os.environ.get("AI_ENABLED", "1") == "1"
AI_API_KEY = os.environ.get("AI_API_KEY", "")
AI_BASE_URL = os.environ.get("AI_BASE_URL", "https://api.openai.com/v1")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-4o-mini")
AI_TIMEOUT = float(os.environ.get("AI_TIMEOUT", 12))

# --- Reliability ------------------------------------------------------------
# Optional Redis for a shared cache across instances. Leave empty for in-memory.
REDIS_URL = os.environ.get("REDIS_URL", "")

# Max seconds a request may take before the timeout middleware intervenes.
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("REQUEST_TIMEOUT_SECONDS", 60))

# JWT config (dev secret - rotate in prod via JWT_SECRET env var)
JWT_SECRET = os.environ.get("JWT_SECRET", "transport-tracker-dev-secret-change-me-2026")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 7

# Dev mode is active while the default secret is in use. Guards dev-only helpers
# (e.g. /auth/dev/make-admin) so they vanish once a real secret is set.
DEV_MODE = JWT_SECRET == "transport-tracker-dev-secret-change-me-2026"

# --- Driver verification ---------------------------------------------------
# Auto-verify an application once every required field is present and the live
# selfie passed liveness. Set AUTO_VERIFY_DRIVERS=0 to force manual admin
# review of every submission instead.
AUTO_VERIFY_DRIVERS = os.environ.get("AUTO_VERIFY_DRIVERS", "1") == "1"

# Minimum number of uploaded ID/license documents required before auto-verify.
VERIFICATION_REQUIRED_DOCS = int(os.environ.get("VERIFICATION_REQUIRED_DOCS", 1))

# Face liveness + ID cross-check provider (SmileID — freemium, free sandbox).
# Leave SMILEDID_PARTNER_ID / SMILEDID_API_KEY empty to keep the offline dev
# stub that auto-passes liveness; the app then runs without any provider.
#   SMILEDID_ENV=sandbox  -> free test identities (see SmileID docs)
#   SMILEDID_ENV=prod     -> live government database lookups (paid, freemium tier)
SMILEDID_PARTNER_ID = os.environ.get("SMILEDID_PARTNER_ID", "")
SMILEDID_API_KEY = os.environ.get("SMILEDID_API_KEY", "")
SMILEDID_ENV = os.environ.get("SMILEDID_ENV", "sandbox")

# SmileID access tokens last 15 minutes; refresh before expiry.
SMILEDID_TOKEN_TTL_SECONDS = int(os.environ.get("SMILEDID_TOKEN_TTL_SECONDS", 840))
# Polling behaviour while waiting on async verification jobs.
SMILEDID_POLL_INTERVAL = int(os.environ.get("SMILEDID_POLL_INTERVAL", 5))
SMILEDID_POLL_TIMEOUT = int(os.environ.get("SMILEDID_POLL_TIMEOUT", 75))

# Consent privacy-notice URL required by SmileID request contracts.
PRIVACY_POLICY_URL = os.environ.get("PRIVACY_POLICY_URL", "https://naijamove.com/privacy")

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
