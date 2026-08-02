"""Password hashing + JWT issuance/decoding."""
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from ..config import JWT_ALG, JWT_SECRET, JWT_TTL_DAYS, PASSWORD_MIN_LENGTH, PASSWORD_REQUIRE_DIGIT


def validate_password(plain: str) -> Optional[str]:
    """Return an error message if the password is too weak, else None."""
    if len(plain) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters"
    if PASSWORD_REQUIRE_DIGIT and not any(ch.isdigit() for ch in plain):
        return "Password must contain at least one number"
    if not any(ch.isalpha() for ch in plain):
        return "Password must contain at least one letter"
    return None


def hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_pw(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def issue_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=JWT_TTL_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sub")
    except jwt.InvalidTokenError:
        return None
