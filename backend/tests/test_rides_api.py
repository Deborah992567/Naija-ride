"""End-to-end tests for the ride-hailing upgrade.
Run: pytest tests/test_rides_api.py -v   (backend server must be running)
"""
import os
import uuid
import pytest
import requests

from conftest import register, make_verified_online_driver

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

LAGOS = {"pickup_lat": 6.5100, "pickup_lng": 3.3700, "dropoff_lat": 6.4534, "dropoff_lng": 3.3942}
WUSE = {"pickup_lat": 9.0765, "pickup_lng": 7.4730, "dropoff_lat": 9.0408, "dropoff_lng": 7.4924}


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


@pytest.fixture(scope="session")
def rider(session, state):
    rid = uuid.uuid4().hex[:8]
    data = {"email": f"RIDER_{rid}@example.com", "password": "pass1234", "name": f"Rider {rid}"}
    r = session.post(f"{API}/auth/register", json=data)
    assert r.status_code == 200, r.text
    state["rider_token"] = r.json()["token"]
    state["rider_id"] = r.json()["user"]["user_id"]
    return r.json()


@pytest.fixture(scope="session")
def driver(session, state):
    acc = make_verified_online_driver(session, "DRIVER", vehicle_type="car", plate="LAG-123", lat=6.5080, lng=3.3720)
    state["driver_token"] = acc["token"]
    state["driver_id"] = acc["user"]["user_id"]
    return acc


class TestDriverFlow:
    def test_driver_me(self, session, driver, state):
        r = session.get(f"{API}/drivers/me", headers={"Authorization": f"Bearer {state['driver_token']}"})
        assert r.status_code == 200
        assert r.json()["vehicle_type"] == "car"

    def test_driver_me_not_registered(self, session, rider, driver, state):
        r = session.get(f"{API}/drivers/me", headers={"Authorization": f"Bearer {state['rider_token']}"})
        assert r.status_code == 404

    def test_drivers_nearby(self, session, driver, state):
        r = session.get(f"{API}/drivers/nearby", params={"lat": 6.51, "lng": 3.37})
        assert r.status_code == 200
        assert any(d["user_id"] == state["driver_id"] for d in r.json())


class TestZonesAndEstimate:
    def test_zones_exist(self, session):
        r = session.get(f"{API}/zones")
        assert r.status_code == 200
        names = [z["zone_name"] for z in r.json()]
        assert "Wuse" in names

    def test_estimate_car_allowed_lagos(self, session, state):
        r = session.post(f"{API}/rides/estimate", json={"vehicle_type": "car", **LAGOS})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["allowed"] is True
        assert body["fare"] > 0
        assert body["distance_km"] > 0
        assert "cash" in body["payment_methods"]

    def test_bike_banned_in_wuse(self, session, state):
        r = session.post(f"{API}/rides/estimate", json={"vehicle_type": "bike", **WUSE})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["allowed"] is False
        assert "Wuse" in (body["reason"] or "")

    def test_car_allowed_in_wuse(self, session, state):
        r = session.post(f"{API}/rides/estimate", json={"vehicle_type": "car", **WUSE})
        assert r.status_code == 200, r.text
        assert r.json()["allowed"] is True


class TestRideLifecycle:
    def test_request_ride(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", "payment_method": "cash", "pickup_address": "Yaba", "dropoff_address": "CMS", **LAGOS},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "requested"
        assert body["fare_estimate"] > 0
        assert body["driver_eta_minutes"] is not None
        state["ride_id"] = body["ride_id"]

    def test_request_bike_in_wuse_rejected(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "bike", **WUSE},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 400

    def test_accept_ride(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides/{state['ride_id']}/accept",
            headers={"Authorization": f"Bearer {state['driver_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "accepted"
        assert body["driver"]["user_id"] == state["driver_id"]

    def test_double_accept_denied(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides/{state['ride_id']}/accept",
            headers={"Authorization": f"Bearer {state['driver_token']}"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"

    def test_ride_status_after_accept(self, session, rider, driver, state):
        r = session.get(f"{API}/rides/{state['ride_id']}", headers={"Authorization": f"Bearer {state['rider_token']}"})
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"
        assert r.json()["driver"]["vehicle_plate"] == "LAG-123"

    def test_arrive_then_start(self, session, rider, driver, state):
        r = session.post(f"{API}/rides/{state['ride_id']}/arrive", headers={"Authorization": f"Bearer {state['driver_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "arriving"
        r = session.post(f"{API}/rides/{state['ride_id']}/start", headers={"Authorization": f"Bearer {state['driver_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "in_progress"

    def test_complete_ride(self, session, rider, driver, state):
        r = session.post(f"{API}/rides/{state['ride_id']}/complete", headers={"Authorization": f"Bearer {state['driver_token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "completed"
        assert body["fare"] > 0
        assert body["payment_method"] == "cash"
        state["trip_id"] = body["trip_id"]


class TestPaymentsAndRatings:
    def test_card_payment_init(self, session, rider, state):
        r = session.post(
            f"{API}/payments/card",
            json={"ride_id": state["ride_id"], "amount": 1000},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["payment_id"]
        assert body["reference"]
        assert body["authorization_url"]
        state["payment_id"] = body["payment_id"]

    def test_card_payment_verify_dev(self, session, rider, state):
        r = session.post(
            f"{API}/payments/card/verify",
            params={"payment_id": state["payment_id"]},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_transfer_details(self, session, rider, state):
        r = session.get(
            f"{API}/payments/transfer/{state['ride_id']}",
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bank_name"]
        assert body["account_number"]
        assert body["amount"] > 0

    def test_set_payment_method(self, session, rider, state):
        r = session.post(
            f"{API}/rides/{state['ride_id']}/payment-method",
            json={"payment_method": "transfer"},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["payment_method"] == "transfer"

    def test_rate_trip(self, session, rider, state):
        r = session.post(
            f"{API}/trips/{state['trip_id']}/rate",
            json={"rating": 5},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["rating"] == 5

    def test_rating_out_of_range(self, session, rider, state):
        r = session.post(
            f"{API}/trips/{state['trip_id']}/rate",
            json={"rating": 9},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 422


class TestRideCancel:
    def test_cancel_requested_ride(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", **LAGOS},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 200, r.text
        cancel_id = r.json()["ride_id"]
        r = session.post(f"{API}/rides/{cancel_id}/cancel", headers={"Authorization": f"Bearer {state['rider_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"

    def test_non_rider_cannot_cancel(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", **LAGOS},
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        cancel_id = r.json()["ride_id"]
        r = session.post(f"{API}/rides/{cancel_id}/cancel", headers={"Authorization": f"Bearer {state['driver_token']}"})
        assert r.status_code == 403

    def test_cancel_completed_ride_rejected(self, session, rider, driver, state):
        r = session.post(
            f"{API}/rides/{state['ride_id']}/cancel",
            headers={"Authorization": f"Bearer {state['rider_token']}"},
        )
        assert r.status_code == 400
