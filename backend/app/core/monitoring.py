"""In-memory request metrics: counters, latency histogram, slowest calls.

Serves the /api/monitoring/metrics endpoint. Metrics are aggregated per
(route, status) so we can spot slow endpoints and error rates at a glance.
Resets on process restart (use an external collector for durable storage).
"""
import threading
import time
from collections import defaultdict, deque

# Latency histogram buckets (ms). A request lands in the first bucket >= its
# duration, plus a catch-all "inf" bucket.
LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]


class MetricsStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started_at = time.time()
        self.total_requests = 0
        self.route_counts: dict[tuple[str, str, int], int] = defaultdict(int)
        self.path_counts: dict[str, int] = defaultdict(int)
        self.status_counts: dict[int, int] = defaultdict(int)
        self.latency_total_ms = 0.0
        self.latency_buckets: dict[str, int] = defaultdict(int)
        self.slowest: deque[dict] = deque(maxlen=50)

    def record(self, method: str, path: str, status: int, duration_ms: float, request_id: str) -> None:
        with self._lock:
            self.total_requests += 1
            self.route_counts[(method, path, status)] += 1
            self.path_counts[path] += 1
            self.status_counts[status] += 1
            self.latency_total_ms += duration_ms
            bucket = "inf"
            for b in LATENCY_BUCKETS_MS:
                if duration_ms <= b:
                    bucket = str(b)
                    break
            self.latency_buckets[bucket] += 1
            self.slowest.append(
                {
                    "ts": round(time.time(), 3),
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "status": status,
                    "duration_ms": round(duration_ms, 3),
                }
            )

    def snapshot(self) -> dict:
        with self._lock:
            total = self.total_requests
            avg_ms = (self.latency_total_ms / total) if total else 0.0
            error_rate = (
                round(sum(c for s, c in self.status_counts.items() if s >= 500) / total, 4)
                if total
                else 0.0
            )
            routes = [
                {"method": m, "path": p, "status": s, "count": c}
                for (m, p, s), c in sorted(self.route_counts.items(), key=lambda kv: -kv[1])
            ]
            return {
                "uptime_seconds": round(time.time() - self.started_at, 1),
                "total_requests": total,
                "avg_latency_ms": round(avg_ms, 3),
                "error_rate_5xx": error_rate,
                "status_counts": dict(self.status_counts),
                "path_counts": dict(self.path_counts),
                "latency_buckets_ms": dict(self.latency_buckets),
                "slowest_requests": list(self.slowest)[:25],
                "routes": routes[:200],
            }


metrics = MetricsStore()
