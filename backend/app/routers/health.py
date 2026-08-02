"""Health/root endpoints: liveness + readiness (DB ping)."""
from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from ..db import engine

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/")
async def root():
    return {"ok": True, "service": "naija-ride"}


@router.get("/health/live")
async def liveness():
    """Process is alive (no dependency check)."""
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}


@router.get("/health/ready")
async def readiness():
    """Ready to serve traffic: verifies the DB is reachable."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - depends on DB state
        return {"status": "not_ready", "checks": {"database": "down"}, "error": str(exc)}, 503
    return {"status": "ready", "checks": {"database": "up"}, "ts": datetime.now(timezone.utc).isoformat()}
