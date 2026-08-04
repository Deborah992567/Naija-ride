"""End-to-end tests for the house moving service.
Run: pytest tests/test_moving_api.py -v   (backend server must be running)
"""
import os
import uuid
import pytest
import requests

from conftest import register, make_verified_online_driver

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

LAGOS = {"origin_lat": 6.5100, "origin_lng": 3.3700, "destination_lat": 6.4534, "destination_lng": 3.3942}


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


@pytest.fixture(scope="session")
def customer(session, state):
    rid = uuid.uuid4().hex[:8]
    data = {"email": f"CUSTOMER_{rid}@example.com", "password": "pass1234", "name": f"Customer {rid}"}
    r = session.post(f"{API}/auth/register", json=data)
    assert r.status_code == 200, r.text
    state["customer_token"] = r.json()["token"]
    state["customer_id"] = r.json()["user"]["user_id"]
    return r.json()


@pytest.fixture(scope="session")
def mover(session, state):
    acc = make_verified_online_driver(session, "MOVER", vehicle_type="car", plate="LAG-777", lat=6.5080, lng=3.3720)
    state["mover_token"] = acc["token"]
    state["mover_id"] = acc["user"]["user_id"]
    return acc


class TestMovingQuote:
    def test_quote(self, session):
        r = session.post(f"{API}/moving/quote", json={"move_type": "home", "truck_size": "medium", **LAGOS})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["allowed"] is True
        assert body["fee"] >= 10000  # moving min fare
        assert body["distance_km"] > 0
        assert body["eta_minutes"] >= 45

    def test_truck_size_multiplier(self, session):
        # Longer route (Lagos -> Ibadan) so the multiplier exceeds the min fare.
        long_route = {"origin_lat": 6.5244, "origin_lng": 3.3792, "destination_lat": 7.3776, "destination_lng": 3.9470}
        small = session.post(f"{API}/moving/quote", json={"truck_size": "small", **long_route}).json()["fee"]
        large = session.post(f"{API}/moving/quote", json={"truck_size": "large", **long_route}).json()["fee"]
        assert large > small


class TestMovingLifecycle:
    def test_create_booking(self, session, customer, mover, state):
        r = session.post(
            f"{API}/moving",
            json={"move_type": "home", "truck_size": "large", "origin_address": "Yaba", "destination_address": "Ikeja", "items": ["3 beds", "2 sofas"], "payment_method": "cash", **LAGOS},
            headers={"Authorization": f"Bearer {state['customer_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "requested"
        assert body["quote_amount"] >= 10000
        assert body["truck_size"] == "large"
        state["booking_id"] = body["booking_id"]

    def test_list_customer(self, session, customer, state):
        r = session.get(f"{API}/moving?role=customer", headers={"Authorization": f"Bearer {state['customer_token']}"})
        assert r.status_code == 200
        assert any(b["booking_id"] == state["booking_id"] for b in r.json())

    def test_accept_booking(self, session, customer, mover, state):
        r = session.post(
            f"{API}/moving/{state['booking_id']}/accept",
            headers={"Authorization": f"Bearer {state['mover_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "accepted"
        assert body["driver"]["user_id"] == state["mover_id"]

    def test_start_then_complete(self, session, customer, mover, state):
        r = session.post(f"{API}/moving/{state['booking_id']}/start", headers={"Authorization": f"Bearer {state['mover_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "in_progress"
        r = session.post(f"{API}/moving/{state['booking_id']}/complete", headers={"Authorization": f"Bearer {state['mover_token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "completed"
        assert body["payment_status"] == "paid"

    def test_get_booking_shared(self, session, customer, mover, state):
        r = session.get(f"{API}/moving/{state['booking_id']}", headers={"Authorization": f"Bearer {state['customer_token']}"})
        assert r.status_code == 200
        assert r.json()["status"] == "completed"
        assert r.json()["driver"]["vehicle_plate"] == "LAG-777"

    def test_list_driver(self, session, customer, mover, state):
        r = session.get(f"{API}/moving?role=driver", headers={"Authorization": f"Bearer {state['mover_token']}"})
        assert r.status_code == 200
        assert any(b["booking_id"] == state["booking_id"] for b in r.json())


class TestMovingCancel:
    def test_cancel_requested(self, session, customer, mover, state):
        r = session.post(
            f"{API}/moving",
            json={"origin_address": "A", "destination_address": "B", **LAGOS},
            headers={"Authorization": f"Bearer {state['customer_token']}"},
        )
        assert r.status_code == 200, r.text
        cancel_id = r.json()["booking_id"]
        r = session.post(f"{API}/moving/{cancel_id}/cancel", headers={"Authorization": f"Bearer {state['customer_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"

    def test_non_customer_cannot_cancel(self, session, customer, mover, state):
        r = session.post(
            f"{API}/moving",
            json={"origin_address": "A", "destination_address": "B", **LAGOS},
            headers={"Authorization": f"Bearer {state['customer_token']}"},
        )
        cancel_id = r.json()["booking_id"]
        r = session.post(f"{API}/moving/{cancel_id}/cancel", headers={"Authorization": f"Bearer {state['mover_token']}"})
        assert r.status_code == 403

    def test_cancel_completed_rejected(self, session, customer, mover, state):
        r = session.post(
            f"{API}/moving/{state['booking_id']}/cancel",
            headers={"Authorization": f"Bearer {state['customer_token']}"},
        )
        assert r.status_code == 400

    def test_set_payment_method(self, session, customer, state):
        r = session.post(
            f"{API}/moving/{state['booking_id']}/payment-method",
            json={"payment_method": "transfer"},
            headers={"Authorization": f"Bearer {state['customer_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["payment_method"] == "transfer"
