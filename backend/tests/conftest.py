"""Shared test fixtures/helpers.
Run: pytest tests/ -v   (backend server must be running)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


def register(session, prefix):
    rid = uuid.uuid4().hex[:8]
    email = f"{prefix}_{rid}@example.com"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": prefix})
    assert r.status_code == 200, r.text
    return {"token": r.json()["token"], "user": r.json()["user"], "email": email}


def make_verified_online_driver(session, prefix, vehicle_type="car", plate="LAG-123", lat=6.5080, lng=3.3720):
    """Register a driver, verify them via the dev admin flow, and take them online."""
    acc = register(session, prefix)
    token = acc["token"]
    r = session.post(
        f"{API}/drivers/register",
        json={"vehicle_type": vehicle_type, "vehicle_plate": plate, "phone": "08000000000"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    r = session.post(
        f"{API}/drivers/verification",
        json={"id_type": "national_id", "id_number": "1234567890"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    r = session.post(f"{API}/auth/dev/make-admin", json={"email": acc["email"]})
    assert r.status_code == 200, r.text
    r = session.post(
        f"{API}/admin/drivers/{acc['user']['user_id']}/verify",
        json={"decision": "verified"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    r = session.post(
        f"{API}/drivers/status",
        json={"is_online": True, "lat": lat, "lng": lng},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return acc
