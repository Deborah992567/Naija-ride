"""End-to-end tests for coupons/promos: admin management, rider discounts, driver bonuses.
Run: pytest tests/test_coupons_api.py -v   (backend server must be running)
"""
import os
import uuid
from datetime import datetime, timedelta
import pytest
import requests

from conftest import register, make_verified_online_driver

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

LAGOS = {"pickup_lat": 6.5100, "pickup_lng": 3.3700, "dropoff_lat": 6.4534, "dropoff_lng": 3.3942}

NOW = datetime.now()
FUTURE = (NOW + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")
PAST = (NOW - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")


def make_admin(session):
    acc = register(session, f"CPADMIN_{uuid.uuid4().hex[:4]}")
    r = session.post(f"{API}/auth/dev/make-admin", json={"email": acc["email"]})
    assert r.status_code == 200, r.text
    return acc["token"]


def create_coupon(session, token, **overrides):
    body = {
        "code": f"TEST{uuid.uuid4().hex[:6].upper()}",
        "description": "test promo",
        "discount_type": "percent",
        "discount_value": 20,
        "audience": "rider",
        "scope": "all",
        "min_trip_fare": 0,
        "valid_from": PAST,
        "valid_to": FUTURE,
        "max_uses": 0,
    }
    body.update(overrides)
    r = session.post(f"{API}/admin/coupons", json=body, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


@pytest.fixture(scope="session")
def admin(session, state):
    state["admin"] = make_admin(session)
    return state["admin"]


@pytest.fixture(scope="session")
def c_rider(session, state):
    acc = register(session, f"CPRIDER_{uuid.uuid4().hex[:4]}")
    state["c_rider"] = acc["token"]
    return acc


@pytest.fixture(scope="session")
def c_driver(session, state):
    acc = make_verified_online_driver(session, f"CPDRIVER_{uuid.uuid4().hex[:4]}")
    state["c_driver"] = acc["token"]
    return acc


class TestAdminCoupons:
    def test_non_admin_forbidden(self, session, c_rider, state):
        r = session.get(f"{API}/admin/coupons", headers={"Authorization": f"Bearer {state['c_rider']}"})
        assert r.status_code == 403

    def test_create_percent_coupon(self, session, admin, state):
        c = create_coupon(session, state["admin"], discount_type="percent", discount_value=20, scope="ride")
        state["pct_coupon"] = c["code"]
        assert c["audience"] == "rider"
        assert c["active"] == 1

    def test_create_fixed_coupon(self, session, admin, state):
        c = create_coupon(session, state["admin"], discount_type="fixed", discount_value=1500, scope="all")
        state["fixed_coupon"] = c["code"]

    def test_create_driver_promo(self, session, admin, state):
        c = create_coupon(session, state["admin"], audience="driver", discount_type="fixed", discount_value=500, scope="all")
        state["driver_promo"] = c["code"]
        assert c["audience"] == "driver"

    def test_duplicate_code_rejected(self, session, admin, state):
        r = session.post(
            f"{API}/admin/coupons",
            json={
                "code": state["pct_coupon"],
                "discount_type": "percent",
                "discount_value": 10,
                "audience": "rider",
                "scope": "ride",
                "valid_from": PAST,
                "valid_to": FUTURE,
            },
            headers={"Authorization": f"Bearer {state['admin']}"},
        )
        assert r.status_code == 400

    def test_list_coupons(self, session, admin, state):
        r = session.get(f"{API}/admin/coupons", headers={"Authorization": f"Bearer {state['admin']}"})
        assert r.status_code == 200
        assert len(r.json()) >= 3

    def test_toggle_coupon(self, session, admin, state):
        r = session.get(f"{API}/admin/coupons", headers={"Authorization": f"Bearer {state['admin']}"})
        cid = r.json()[0]["coupon_id"]
        r = session.post(f"{API}/admin/coupons/{cid}/toggle", headers={"Authorization": f"Bearer {state['admin']}"})
        assert r.status_code == 200, r.text
        before = r.json()["active"]
        r = session.post(f"{API}/admin/coupons/{cid}/toggle", headers={"Authorization": f"Bearer {state['admin']}"})
        assert r.json()["active"] == (0 if before else 1)


class TestRiderCoupons:
    def test_validate_percent(self, session, c_rider, state):
        r = session.post(
            f"{API}/coupons/validate",
            json={"code": state["pct_coupon"], "scope": "ride", "fare": 5000},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["discount"] == 1000
        assert body["fare_after"] == 4000

    def test_validate_fixed_capped(self, session, c_rider, state):
        r = session.post(
            f"{API}/coupons/validate",
            json={"code": state["fixed_coupon"], "scope": "ride", "fare": 2000},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        assert r.status_code == 200
        assert r.json()["discount"] == 1500

    def test_driver_coupon_not_valid_for_rider(self, session, c_rider, state):
        r = session.post(
            f"{API}/coupons/validate",
            json={"code": state["driver_promo"], "scope": "ride", "fare": 5000},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        assert r.status_code == 400

    def test_apply_coupon_to_ride(self, session, c_rider, c_driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", "coupon_code": state["pct_coupon"], **LAGOS},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        assert r.status_code == 200, r.text
        ride = r.json()
        assert ride["status"] == "requested"
        # fare should be discounted: baseline * 0.8
        r2 = session.post(
            f"{API}/rides/estimate",
            json={"vehicle_type": "car", **LAGOS},
        )
        assert r2.json()["fare"] > ride["fare_estimate"]
        state["coupon_ride_id"] = ride["ride_id"]

    def test_coupon_single_use(self, session, c_rider, state):
        r = session.post(
            f"{API}/coupons/validate",
            json={"code": state["pct_coupon"], "scope": "ride", "fare": 5000},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        assert r.status_code == 400
        assert "already used" in r.json()["detail"]

    def test_unknown_coupon(self, session, c_rider, state):
        r = session.post(
            f"{API}/coupons/validate",
            json={"code": "NOPE123", "scope": "ride", "fare": 5000},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        assert r.status_code == 404


class TestDriverBonus:
    def test_driver_earns_bonus(self, session, c_rider, c_driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", **LAGOS},
            headers={"Authorization": f"Bearer {state['c_rider']}"},
        )
        ride = r.json()
        for action in ("accept", "arrive", "start"):
            r = session.post(f"{API}/rides/{ride['ride_id']}/{action}", headers={"Authorization": f"Bearer {state['c_driver']}"})
            assert r.status_code == 200, r.text
        r = session.post(f"{API}/rides/{ride['ride_id']}/complete", headers={"Authorization": f"Bearer {state['c_driver']}"})
        assert r.status_code == 200, r.text
        fare = ride["fare_estimate"]

        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['c_driver']}"})
        balance = r.json()["balance"]
        # driver_share(fare) + 500 fixed bonus
        assert balance == pytest.approx(fare * 0.85 + 500, abs=0.01)

        r = session.get(f"{API}/coupons/my", headers={"Authorization": f"Bearer {state['c_driver']}"})
        assert any("bonus_ride" in (rd["entity_id"] or "") for rd in r.json())

    def test_deactivate_driver_promo(self, session, admin, state):
        """Deactivate the global driver promo so later test files (wallet) see clean earnings."""
        r = session.get(f"{API}/admin/coupons", headers={"Authorization": f"Bearer {state['admin']}"})
        promos = [c for c in r.json() if c["code"] == state["driver_promo"]]
        assert promos
        r = session.post(f"{API}/admin/coupons/{promos[0]['coupon_id']}/toggle", headers={"Authorization": f"Bearer {state['admin']}"})
        assert r.status_code == 200
        assert r.json()["active"] == 0
