"""Thread-safe in-process TTL cache for hot, read-heavy data.

Used for zones, pricing rules, and place-search results so we don't hammer the
DB or the upstream Nominatim API. It is process-local, which is fine for a
single instance; for horizontal scaling you can swap the backend for Redis
without changing call sites (the public API is just get/set/delete/clear).
"""
import threading
import time
from typing import Any, Optional


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
