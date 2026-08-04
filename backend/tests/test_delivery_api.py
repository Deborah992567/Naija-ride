"""End-to-end tests for the delivery/dispatch service.
Run: pytest tests/test_delivery_api.py -v   (backend server must be running)
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
def sender(session, state):
    rid = uuid.uuid4().hex[:8]
    data = {"email": f"SENDER_{rid}@example.com", "password": "pass1234", "name": f"Sender {rid}"}
    r = session.post(f"{API}/auth/register", json=data)
    assert r.status_code == 200, r.text
    state["sender_token"] = r.json()["token"]
    state["sender_id"] = r.json()["user"]["user_id"]
    return r.json()


@pytest.fixture(scope="session")
def courier(session, state):
    acc = make_verified_online_driver(session, "COURIER", vehicle_type="car", plate="LAG-999", lat=6.5080, lng=3.3720)
    state["courier_token"] = acc["token"]
    state["courier_id"] = acc["user"]["user_id"]
    return acc


class TestDeliveryQuote:
    def test_quote(self, session):
        r = session.post(f"{API}/delivery/quote", json={"package_type": "parcel", "weight_kg": 3.0, **LAGOS})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["allowed"] is True
        assert body["fee"] > 0
        assert body["distance_km"] > 0
        assert body["eta_minutes"] > 0

    def test_quote_weight_surcharge(self, session):
        light = session.post(f"{API}/delivery/quote", json={"package_type": "parcel", **LAGOS}).json()["fee"]
        heavy = session.post(f"{API}/delivery/quote", json={"package_type": "parcel", "weight_kg": 20.0, **LAGOS}).json()["fee"]
        assert heavy > light


class TestDeliveryLifecycle:
    def test_create_delivery(self, session, sender, courier, state):
        r = session.post(
            f"{API}/delivery",
            json={"package_type": "food", "weight_kg": 1.5, "recipient_name": "Ada", "recipient_phone": "08100000000", "payment_method": "cash", "pickup_address": "Yaba", "dropoff_address": "CMS", **LAGOS},
            headers={"Authorization": f"Bearer {state['sender_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "requested"
        assert body["delivery_fee"] > 0
        assert body["recipient_name"] == "Ada"
        state["delivery_id"] = body["delivery_id"]

    def test_list_requester(self, session, sender, state):
        r = session.get(f"{API}/delivery?role=requester", headers={"Authorization": f"Bearer {state['sender_token']}"})
        assert r.status_code == 200
        assert any(d["delivery_id"] == state["delivery_id"] for d in r.json())

    def test_accept_delivery(self, session, sender, courier, state):
        r = session.post(
            f"{API}/delivery/{state['delivery_id']}/accept",
            headers={"Authorization": f"Bearer {state['courier_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "accepted"
        assert body["driver"]["user_id"] == state["courier_id"]

    def test_pickup_then_start(self, session, sender, courier, state):
        r = session.post(f"{API}/delivery/{state['delivery_id']}/pickup", headers={"Authorization": f"Bearer {state['courier_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "picked_up"
        r = session.post(f"{API}/delivery/{state['delivery_id']}/start", headers={"Authorization": f"Bearer {state['courier_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "in_transit"

    def test_complete_delivery(self, session, sender, courier, state):
        r = session.post(f"{API}/delivery/{state['delivery_id']}/complete", headers={"Authorization": f"Bearer {state['courier_token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "delivered"
        assert body["payment_status"] == "paid"

    def test_get_delivery_shared(self, session, sender, courier, state):
        r = session.get(f"{API}/delivery/{state['delivery_id']}", headers={"Authorization": f"Bearer {state['sender_token']}"})
        assert r.status_code == 200
        assert r.json()["status"] == "delivered"
        assert r.json()["driver"]["vehicle_plate"] == "LAG-999"

    def test_list_driver(self, session, sender, courier, state):
        r = session.get(f"{API}/delivery?role=driver", headers={"Authorization": f"Bearer {state['courier_token']}"})
        assert r.status_code == 200
        assert any(d["delivery_id"] == state["delivery_id"] for d in r.json())


class TestDeliveryCancel:
    def test_cancel_requested(self, session, sender, courier, state):
        r = session.post(
            f"{API}/delivery",
            json={**LAGOS},
            headers={"Authorization": f"Bearer {state['sender_token']}"},
        )
        assert r.status_code == 200, r.text
        cancel_id = r.json()["delivery_id"]
        r = session.post(f"{API}/delivery/{cancel_id}/cancel", headers={"Authorization": f"Bearer {state['sender_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"

    def test_non_requester_cannot_cancel(self, session, sender, courier, state):
        r = session.post(
            f"{API}/delivery",
            json={**LAGOS},
            headers={"Authorization": f"Bearer {state['sender_token']}"},
        )
        cancel_id = r.json()["delivery_id"]
        r = session.post(f"{API}/delivery/{cancel_id}/cancel", headers={"Authorization": f"Bearer {state['courier_token']}"})
        assert r.status_code == 403

    def test_cancel_completed_rejected(self, session, sender, courier, state):
        r = session.post(
            f"{API}/delivery/{state['delivery_id']}/cancel",
            headers={"Authorization": f"Bearer {state['sender_token']}"},
        )
        assert r.status_code == 400

    def test_set_payment_method(self, session, sender, state):
        r = session.post(
            f"{API}/delivery/{state['delivery_id']}/payment-method",
            json={"payment_method": "transfer"},
            headers={"Authorization": f"Bearer {state['sender_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["payment_method"] == "transfer"
