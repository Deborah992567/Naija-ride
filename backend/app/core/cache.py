"""Thread-safe in-process TTL cache for hot, read-heavy data.

Used for zones, pricing rules, and place-search results so we don't hammer the
DB or the upstream Nominatim API. It is process-local, which is fine for a
single instance; for horizontal scaling an optional Redis-backed JSON cache
(`redis_cache`) is used for JSON-safe payloads when REDIS_URL is configured.
"""
import json
import logging
import threading
import time
from typing import Any, Optional

logger = logging.getLogger("naija-ride")


class TTLCache:
    def __init__(self, default_ttl: float = 60.0) -> None:
        self._default_ttl = default_ttl
        self._store: dict[str, tuple[Any, float]] = {}
        self._hits = 0
        self._misses = 0
        self._lock = threading.Lock()

    def get(self, key: str) -> Any:
        with self._lock:
            item = self._store.get(key)
            if item is None:
                self._misses += 1
                return None
            value, expires = item
            if expires < time.monotonic():
                self._store.pop(key, None)
                self._misses += 1
                return None
            self._hits += 1
            return value

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        with self._lock:
            self._store[key] = (value, time.monotonic() + (ttl if ttl is not None else self._default_ttl))

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def delete_prefix(self, prefix: str) -> int:
        """Remove every key starting with `prefix`. Returns number removed."""
        removed = 0
        with self._lock:
            for key in [k for k in self._store if k.startswith(prefix)]:
                self._store.pop(key, None)
                removed += 1
        return removed

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def stats(self) -> dict:
        with self._lock:
            total = self._hits + self._misses
            return {
                "size": len(self._store),
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / total, 3) if total else 0.0,
            }


# Shared process-wide cache instance.
cache = TTLCache()


class RedisJSONCache:
    """Optional Redis-backed cache for JSON-safe payloads (e.g. place search).

    Only active when REDIS_URL is set and the `redis` package is installed.
    Falls back cleanly to a no-op when unavailable, leaving the in-memory
    `cache` as the store.
    """

    def __init__(self, redis_url: str = "") -> None:
        self.redis_url = redis_url
        self._client: Optional[Any] = None
        self.enabled = False
        if redis_url:
            try:
                import redis.asyncio as aioredis  # type: ignore[import-not-found]

                self._client = aioredis.from_url(redis_url, decode_responses=True)
                self.enabled = True
                logger.info("Redis-backed cache enabled at %s", redis_url)
            except Exception as exc:  # pragma: no cover - env dependent
                logger.warning("Redis cache disabled: %s", exc)

    async def aget(self, key: str) -> Any:
        if not self.enabled:
            return None
        try:
            raw = await self._client.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception as exc:
            logger.warning("Redis get failed: %s", exc)
            return None

    async def aset(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        if not self.enabled:
            return
        try:
            await self._client.setex(key, int(ttl or 60), json.dumps(value, default=str))
        except Exception as exc:
            logger.warning("Redis set failed: %s", exc)

    async def adelete_prefix(self, prefix: str) -> int:
        if not self.enabled:
            return 0
        try:
            keys = [k async for k in self._client.scan_iter(match=f"{prefix}*")]
            if keys:
                await self._client.delete(*keys)
            return len(keys)
        except Exception as exc:
            logger.warning("Redis delete_prefix failed: %s", exc)
            return 0

    async def aclear(self) -> None:
        if not self.enabled:
            return
        try:
            await self._client.flushdb()
        except Exception as exc:
            logger.warning("Redis flush failed: %s", exc)


redis_cache = RedisJSONCache()


async def get_cached(key: str) -> Any:
    """Hybrid read: in-memory L1 fast path, then Redis L2 (backfilled)."""
    value = cache.get(key)
    if value is not None:
        return value
    if redis_cache.enabled:
        value = await redis_cache.aget(key)
        if value is not None:
            cache.set(key, value)
            return value
    return None


async def set_cached(key: str, value: Any, ttl: Optional[float] = None) -> None:
    """Write to both in-memory L1 and Redis L2 (if enabled)."""
    if redis_cache.enabled:
        await redis_cache.aset(key, value, ttl)
    cache.set(key, value, ttl)
