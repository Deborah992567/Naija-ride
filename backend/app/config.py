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

# --- In-house biometrics (face liveness + face match) ---------------------
# Liveness and selfie-vs-ID-document face matching run on our own server with
# ONNX models (OpenCV Zoo: YuNet for face detection, SFace for embeddings).
# Only the government ID-number cross-check (NIN/BVN) is delegated to SmileID.
# Models auto-download on first use into BIOMETRIC_MODELS_DIR.
BIOMETRIC_MODELS_DIR = Path(os.environ.get("BIOMETRIC_MODELS_DIR", str(ROOT_DIR / "models")))
BIOMETRIC_MODELS_URL = os.environ.get(
    "BIOMETRIC_MODELS_URL", "https://github.com/opencv/opencv_zoo/raw/main/models"
)

# SFace cosine similarity required to call the selfie a match for the face on
# the uploaded ID document (0..1; ~0.36 is the vendor-suggested verification
# threshold, we bias a little stricter for ride safety).
FACE_MATCH_MIN_SCORE = float(os.environ.get("FACE_MATCH_MIN_SCORE", 0.45))

# Liveness video analysis thresholds (the selfie clip must show the driver's
# face in most frames AND move naturally - rejects still photos and screens).
LIVENESS_MIN_DURATION_SECONDS = float(os.environ.get("LIVENESS_MIN_DURATION_SECONDS", 1.2))
LIVENESS_MIN_FACE_RATIO = float(os.environ.get("LIVENESS_MIN_FACE_RATIO", 0.8))
LIVENESS_MIN_FACE_CONF = float(os.environ.get("LIVENESS_MIN_FACE_CONF", 0.5))
LIVENESS_MIN_MOTION = float(os.environ.get("LIVENESS_MIN_MOTION", 0.02))
LIVENESS_MAX_FRAMES = int(os.environ.get("LIVENESS_MAX_FRAMES", 16))

# Challenge-response liveness: the app shows random head-shake / nod / hold-still
# instructions and the server verifies the driver actually performed them in
# order. A random sequence defeats video-replay attacks (the attacker can't have
# footage of the target performing this exact unknown sequence).
# Head-pose features are normalized by image width/height; a clear look/nod
# moves the nose ~0.08-0.15 units, while true stillness stays below ~0.05-0.08.
LIVENESS_CHALLENGE_STEP_SECONDS = float(os.environ.get("LIVENESS_CHALLENGE_STEP_SECONDS", 1.5))
LIVENESS_CHALLENGE_LEAD_SECONDS = float(os.environ.get("LIVENESS_CHALLENGE_LEAD_SECONDS", 0.8))
# Min normalized landmark swing that counts as performing the instructed movement.
LIVENESS_CHALLENGE_MIN_DEVIATION = float(os.environ.get("LIVENESS_CHALLENGE_MIN_DEVIATION", 0.08))
# Max normalized landmark swing allowed while told to hold still.
LIVENESS_CHALLENGE_STILL_MAX = float(os.environ.get("LIVENESS_CHALLENGE_STILL_MAX", 0.12))
# How long an issued challenge stays valid (seconds) before the driver must retry.
LIVENESS_CHALLENGE_TTL_SECONDS = float(os.environ.get("LIVENESS_CHALLENGE_TTL_SECONDS", 300))

# File storage shared by the upload router and the biometric engine.
UPLOAD_DIR = ROOT_DIR / "uploads"
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 15 * 1024 * 1024))

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
