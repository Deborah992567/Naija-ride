"""Monitoring/observability endpoints: metrics, extended health, log tail."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import MONITORING_EXPOSE_LOGS
from ..core.cache import cache
from ..core.deps import require_admin
from ..core.logging import tail_log_file
from ..core.monitoring import metrics

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("/metrics")
async def get_metrics():
    """Request counters, latency histogram, and slowest requests."""
    return metrics.snapshot()


@router.get("/cache")
async def get_cache_stats():
    """Cache size, hit/miss counters, and current keys."""
    return {
        "engine": "in-memory-ttl",
        **cache.stats(),
    }


@router.get("/logs")
async def get_logs(
    lines: int = Query(100, ge=1, le=2000),
    _admin = Depends(require_admin),
):
    """Tail of the structured app log (admins only; gated by
    MONITORING_EXPOSE_LOGS=1)."""
    if not MONITORING_EXPOSE_LOGS:
        raise HTTPException(status_code=404, detail="Log access is disabled")
    return {"engine": "rotating-file", "log_file": "backend/logs/app.log", "lines": tail_log_file(lines)}
