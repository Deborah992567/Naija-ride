"""End-to-end tests for safety features: emergency contacts, SOS, trip sharing.
Run: pytest tests/test_safety_api.py -v   (backend server must be running)
"""
import os
import uuid
import pytest
import requests

from conftest import register, make_verified_online_driver

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

LAGOS = {"pickup_lat": 6.5100, "pickup_lng": 3.3700, "dropoff_lat": 6.4534, "dropoff_lng": 3.3942}


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


@pytest.fixture(scope="session")
def s_rider(session, state):
    acc = register(session, f"SAFE_{uuid.uuid4().hex[:4]}")
    state["s_rider"] = acc["token"]
    return acc


@pytest.fixture(scope="session")
def s_driver(session, state):
    acc = make_verified_online_driver(session, f"SAFED_{uuid.uuid4().hex[:4]}")
    state["s_driver"] = acc["token"]
    return acc


class TestEmergencyContacts:
    def test_add_contact(self, session, s_rider, state):
        r = session.post(
            f"{API}/safety/contacts",
            json={"name": "Mum", "phone": "08012345678"},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "Mum"
        state["contact_id"] = body["contact_id"]

    def test_add_second_contact(self, session, s_rider, state):
        r = session.post(
            f"{API}/safety/contacts",
            json={"name": "Best Friend", "phone": "08098765432"},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 200, r.text

    def test_list_contacts(self, session, s_rider, state):
        r = session.get(f"{API}/safety/contacts", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 2
        assert any(c["phone"] == "08012345678" for c in body)

    def test_short_phone_rejected(self, session, s_rider, state):
        r = session.post(
            f"{API}/safety/contacts",
            json={"name": "X", "phone": "123"},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 400

    def test_delete_contact(self, session, s_rider, state):
        r = session.delete(f"{API}/safety/contacts/{state['contact_id']}", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 200, r.text
        r = session.get(f"{API}/safety/contacts", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert len(r.json()) == 1


class TestEmergencySOS:
    def test_raise_emergency_standalone(self, session, s_rider, state):
        r = session.post(
            f"{API}/safety/emergency",
            json={"message": "I feel unsafe", "lat": 6.51, "lng": 3.37},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "raised"
        state["emergency_id"] = body["emergency_id"]

    def test_raise_emergency_on_ride_alerts_driver(self, session, s_rider, s_driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", **LAGOS},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        ride_id = r.json()["ride_id"]
        r = session.post(f"{API}/rides/{ride_id}/accept", headers={"Authorization": f"Bearer {state['s_driver']}"})
        assert r.status_code == 200, r.text

        r = session.post(
            f"{API}/safety/emergency",
            json={"ride_id": ride_id, "message": "SOS"},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["ride_id"] == ride_id

        r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {state['s_driver']}"})
        assert any(n["category"] == "safety" for n in r.json())

    def test_emergency_not_owner_forbidden(self, session, s_rider, s_driver, state):
        r = session.post(
            f"{API}/safety/emergency",
            json={"message": "x"},
            headers={"Authorization": f"Bearer {state['s_driver']}"},
        )
        rid = r.json()["emergency_id"]
        r = session.post(f"{API}/safety/emergency/{rid}/resolve", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 403

    def test_resolve_emergency(self, session, s_rider, state):
        r = session.post(f"{API}/safety/emergency/{state['emergency_id']}/resolve", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "resolved"

    def test_my_emergencies(self, session, s_rider, state):
        r = session.get(f"{API}/safety/emergency/my", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 200
        assert len(r.json()) >= 2


class TestTripSharing:
    def test_share_requires_rider(self, session, s_rider, s_driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", **LAGOS},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        ride_id = r.json()["ride_id"]
        state["share_ride_id"] = ride_id
        r = session.post(f"{API}/rides/{ride_id}/share", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["token"]
        assert body["url"].endswith(body["token"])
        state["share_token"] = body["token"]

    def test_share_forbidden_for_driver(self, session, s_rider, s_driver, state):
        r = session.post(f"{API}/rides/{state['share_ride_id']}/share", headers={"Authorization": f"Bearer {state['s_driver']}"})
        assert r.status_code == 403

    def test_shared_trip_public_view(self, session, s_rider, s_driver, state):
        r = session.post(f"{API}/rides/{state['share_ride_id']}/accept", headers={"Authorization": f"Bearer {state['s_driver']}"})
        assert r.status_code == 200, r.text
        r = session.get(f"{API}/rides/share/{state['share_token']}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "accepted"
        assert body["driver_name"]
        assert body["vehicle_plate"]
        assert body["ride_id"] == state["share_ride_id"]

    def test_unknown_share_token(self, session, s_rider):
        r = session.get(f"{API}/rides/share/doesnotexist")
        assert r.status_code == 404
