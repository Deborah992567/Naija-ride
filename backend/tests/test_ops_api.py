"""Tests for observability, reliability, and assistant endpoints.
Run: pytest tests/test_ops_api.py -v   (backend server must be running)
"""
import os
import pytest

from conftest import register

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def test_liveness_and_readiness(session):
    r = session.get(f"{API}/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    r = session.get(f"{API}/health/ready")
    assert r.status_code == 200
    assert r.json()["checks"]["database"] == "up"


def test_security_headers_present(session):
    r = session.get(f"{API}/health/live")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"
    assert r.headers.get("content-security-policy")
    assert r.headers.get("x-request-id")


def test_metrics_json(session):
    r = session.get(f"{API}/monitoring/metrics")
    assert r.status_code == 200
    data = r.json()
    for key in ("total_requests", "avg_latency_ms", "status_counts", "latency_buckets_ms"):
        assert key in data


def test_prometheus_format(session):
    r = session.get(f"{API}/monitoring/prometheus")
    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    assert "naija_ride_requests_total" in r.text


def test_cache_stats(session):
    r = session.get(f"{API}/monitoring/cache")
    assert r.status_code == 200
    data = r.json()
    assert data["engine"] in ("in-memory-ttl", "redis-json")
    assert "hit_rate" in data


def test_assistant_offline_faq(session):
    acc = register(session, "ops_asst")
    headers = {"Authorization": f"Bearer {acc['token']}"}
    r = session.post(f"{API}/assistant/message", json={"message": "how much is my wallet balance?"}, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] in ("ai", "faq")
    assert "wallet" in data["reply"].lower() or "balance" in data["reply"].lower()


def test_assistant_requires_auth(session):
    r = session.post(f"{API}/assistant/message", json={"message": "hi"})
    assert r.status_code in (401, 403)


def test_data_export(session):
    acc = register(session, "ops_export")
    headers = {"Authorization": f"Bearer {acc['token']}"}
    r = session.get(f"{API}/auth/export-data", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["user"]["email"] == acc["email"]
    assert "rides" in data
