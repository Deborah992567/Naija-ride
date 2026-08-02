"""In-process sliding-window rate limiter for the HTTP API.

Limits are applied per client IP using a fixed-window counter. Configurable
limits: a general cap, a tight cap on auth endpoints (brute-force protection),
and a cap on upstream-hitting endpoints (places search). Clients that exceed a
limit get a 429 with a `Retry-After` header.
"""
import threading
import time
from collections import defaultdict
from typing import Optional

from ..config import (
    RATE_LIMIT_AUTH,
    RATE_LIMIT_ENABLED,
    RATE_LIMIT_EXEMPT_LOCALHOST,
    RATE_LIMIT_GENERAL,
    RATE_LIMIT_PLACES,
    RATE_LIMIT_WINDOW_SECONDS,
)

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}

# (method, path_prefix, limit_per_window)
_AUTH_PATHS = ("/api/auth/", "/api/me/")
_PLACES_PATHS = ("/api/places/",)


def _limit_for(method: str, path: str) -> Optional[int]:
    if path.startswith(_AUTH_PATHS):
        return RATE_LIMIT_AUTH
    if path.startswith(_PLACES_PATHS):
        return RATE_LIMIT_PLACES
    return RATE_LIMIT_GENERAL


class RateLimiter:
    """Fixed-window counter keyed by (client_ip, window_start)."""

    def __init__(self) -> None:
        self._buckets: dict[tuple[str, int], int] = defaultdict(int)
        self._lock = threading.Lock()
        self._last_purge = time.monotonic()

    def check(self, client_ip: str, method: str, path: str) -> tuple[bool, Optional[int]]:
        """Return (allowed, retry_after_seconds)."""
        if not RATE_LIMIT_ENABLED:
            return True, None
        if RATE_LIMIT_EXEMPT_LOCALHOST and client_ip in _LOOPBACK:
            return True, None
        limit = _limit_for(method, path)
        if not limit:
            return True, None

        now = time.monotonic()
        window = int(now // RATE_LIMIT_WINDOW_SECONDS)
        key = (client_ip, window)
        with self._lock:
            # Opportunistic purge of stale windows.
            if now - self._last_purge > RATE_LIMIT_WINDOW_SECONDS:
                cutoff = int((now - RATE_LIMIT_WINDOW_SECONDS) // RATE_LIMIT_WINDOW_SECONDS)
                for k in [k for k in self._buckets if k[1] < cutoff]:
                    self._buckets.pop(k, None)
                self._last_purge = now

            used = self._buckets[key]
            if used >= limit:
                retry_after = max(1, RATE_LIMIT_WINDOW_SECONDS - (now - window * RATE_LIMIT_WINDOW_SECONDS))
                return False, int(retry_after)
            self._buckets[key] = used + 1
            return True, None

    def reset(self, client_ip: Optional[str] = None) -> None:
        with self._lock:
            if client_ip:
                for k in [k for k in self._buckets if k[0] == client_ip]:
                    self._buckets.pop(k, None)
            else:
                self._buckets.clear()


rate_limiter = RateLimiter()


def client_ip_from_scope(scope: dict) -> str:
    """Best-effort client IP, honoring X-Forwarded-For when behind a proxy."""
    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = scope.get("client")
    return (client[0] if client else "unknown") or "unknown"
