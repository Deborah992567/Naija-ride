"""Centralised structured logging, event tracking, and request telemetry.

Every log line is emitted as JSON so it can be shipped to a log aggregator
(Datadog, Loki, CloudWatch, ...) or inspected locally. Three logger channels
exist under the `naija-ride` namespace:

- `naija-ride`        generic application logs
- `naija-ride.events` domain/business events (login, signup, ride.*, ...)
- `naija-ride.access` one line per HTTP request with latency + status
"""
import json
import logging
import time
import uuid
from logging.handlers import RotatingFileHandler
from typing import Any, Optional

from ..config import (
    LOG_DIR,
    LOG_FILE_BACKUPS,
    LOG_FILE_MAX_BYTES,
    LOG_LEVEL,
)

EVENT_LOGGER = "naija-ride.events"
ACCESS_LOGGER = "naija-ride.access"
APP_LOGGER = "naija-ride"


class JsonFormatter(logging.Formatter):
    """Render a LogRecord as a single line of JSON."""

    _EXTRA_FIELDS = (
        "scope",
        "event",
        "request_id",
        "user_id",
        "duration_ms",
        "method",
        "path",
        "status_code",
        "entity_id",
        "entity_type",
    )

    def format(self, record: logging.LogRecord) -> str:
        # %f isn't supported by strftime; add microseconds manually.
        base = self.formatTime(record, "%Y-%m-%dT%H:%M:%S")
        timestamp = f"{base}.{record.msecs:03.0f}"
        payload: dict[str, Any] = {
            "ts": timestamp,
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in self._EXTRA_FIELDS:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info and record.exc_info[0]:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Idempotently configure the `naija-ride` logger tree."""
    app = logging.getLogger(APP_LOGGER)
    if getattr(app, "_configured", False):
        return

    app.setLevel(LOG_LEVEL)
    formatter = JsonFormatter()

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    app.addHandler(console)

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        LOG_DIR / "app.log",
        maxBytes=LOG_FILE_MAX_BYTES,
        backupCount=LOG_FILE_BACKUPS,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    app.addHandler(file_handler)

    # Child channels inherit handlers via propagation; disable propagate on app
    # itself is unnecessary since nothing above it has handlers.
    for name in (EVENT_LOGGER, ACCESS_LOGGER):
        child = logging.getLogger(name)
        child.setLevel(LOG_LEVEL)
        child.propagate = True

    app._configured = True


def log_event(scope: str, event: str, **fields: Any) -> None:
    """Emit a structured domain/business event (e.g. `auth`, `user.login`).

    Example:
        log_event("auth", "user.login", user_id=uid, email=email)
    """
    logging.getLogger(EVENT_LOGGER).info(
        f"{scope}.{event}",
        extra={"scope": scope, "event": event, **fields},
    )


def log_access(
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    request_id: str,
    user_id: Optional[str] = None,
) -> None:
    """Emit one structured line per HTTP request, including latency."""
    extra: dict[str, Any] = {
        "request_id": request_id,
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": round(duration_ms, 3),
    }
    if user_id:
        extra["user_id"] = user_id
    logging.getLogger(ACCESS_LOGGER).info("request", extra=extra)


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


class LatencyMiddleware:
    """Times every request, tags it with a request id, records metrics, and
    emits an access log line (latency + status) for monitoring."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http",):
            await self.app(scope, receive, send)
            return

        from .monitoring import metrics  # deferred to avoid circular import

        start = time.perf_counter()
        request_id = scope.get("headers", None)
        req_id = new_request_id()
        # Inject a request id into the scope so handlers/middleware can read it.
        scope.setdefault("state", {})["request_id"] = req_id

        status_holder = {"status": 500}
        method = scope.get("method", "")
        path = scope.get("path", "")

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = (time.perf_counter() - start) * 1000.0
            status = status_holder["status"]
            metrics.record(method, path, status, duration_ms, req_id)
            log_access(method, path, status, duration_ms, req_id)


def tail_log_file(lines: int = 100) -> list[str]:
    """Return the last `lines` lines of the rotating app log."""
    log_file = LOG_DIR / "app.log"
    if not log_file.exists():
        return []
    with open(log_file, encoding="utf-8", errors="replace") as fh:
        # Read from the end in chunks to avoid loading the whole file.
        return fh.read().splitlines()[-lines:]
