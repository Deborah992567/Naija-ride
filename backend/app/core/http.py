"""HTTP client helpers with retries, exponential backoff, and a circuit breaker.

External dependencies (Paystack, Nominatim, Emergent) should never take the
whole API down or wedge a request. `client_request` retries transient failures
and returns the response; use `parse_response_json` for the body.
"""
import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger("naija-ride")


class CircuitOpenError(RuntimeError):
    """Raised when the circuit breaker is open (upstream marked unhealthy)."""


class CircuitBreaker:
    """Trips open after `failure_threshold` consecutive failures, then allows a
    probe after `reset_seconds`. Coarse-grained: one breaker per host."""

    def __init__(self, failure_threshold: int = 5, reset_seconds: float = 30.0) -> None:
        self.failure_threshold = failure_threshold
        self.reset_seconds = reset_seconds
        self._failures = 0
        self._opened_at: Optional[datetime] = None

    def allow_request(self) -> bool:
        if self._opened_at is None:
            return True
        if (datetime.now(timezone.utc) - self._opened_at).total_seconds() >= self.reset_seconds:
            # Half-open: allow a probe through.
            self._failures = 0
            return True
        return False

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self.failure_threshold:
            self._opened_at = self._opened_at or datetime.now(timezone.utc)
            logger.warning("Circuit opened for upstream (threshold=%d)", self.failure_threshold)


_BREAKERS: dict[str, CircuitBreaker] = {}


def _breaker_for(url: str) -> CircuitBreaker:
    from urllib.parse import urlparse

    host = urlparse(url).netloc or "unknown"
    if host not in _BREAKERS:
        _BREAKERS[host] = CircuitBreaker()
    return _BREAKERS[host]


async def client_request(
    method: str,
    url: str,
    *,
    retries: int = 3,
    base_delay: float = 0.4,
    max_delay: float = 3.0,
    timeout: httpx.Timeout | float = httpx.Timeout(10.0),
    headers: Optional[dict] = None,
    json: Optional[dict] = None,
    params: Optional[dict] = None,
) -> httpx.Response:
    """Issue a request with retry/backoff. Returns the response on success."""
    breaker = _breaker_for(url)
    if not breaker.allow_request():
        raise CircuitOpenError(f"Upstream {url} is temporarily unavailable (circuit open)")

    last_error: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        for attempt in range(retries + 1):
            try:
                resp = await client.request(method, url, json=json, params=params)
                if resp.status_code >= 500 or resp.status_code in (408, 429):
                    raise httpx.HTTPStatusError(
                        f"Upstream {url} -> {resp.status_code}", request=resp.request, response=resp
                    )
                breaker.record_success()
                return resp
            except (httpx.HTTPError, asyncio.TimeoutError) as exc:
                last_error = exc
                breaker.record_failure()
                if attempt >= retries:
                    break
                delay = min(max_delay, base_delay * (2**attempt)) + random.uniform(0, 0.25)
                await asyncio.sleep(delay)

    raise last_error if isinstance(last_error, Exception) else RuntimeError(f"Request failed: {url}")


async def fetch_json(
    method: str,
    url: str,
    *,
    expected_status: int = 200,
    **kwargs: Any,
) -> dict:
    """Return the parsed JSON body of a successful upstream call."""
    resp = await client_request(method, url, **kwargs)
    try:
        return resp.json()
    except ValueError as exc:
        raise RuntimeError(f"Upstream returned non-JSON: {url}") from exc
