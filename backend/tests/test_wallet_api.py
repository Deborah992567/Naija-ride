"""End-to-end tests for wallets, top-up, earnings/commission, and payouts.
Run: pytest tests/test_wallet_api.py -v   (backend server must be running)
"""
import os
import uuid
import pytest
import requests

from conftest import register, make_verified_online_driver

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

LAGOS = {"pickup_lat": 6.5100, "pickup_lng": 3.3700, "dropoff_lat": 6.4534, "dropoff_lng": 3.3942}


def topup(session, token, amount):
    r = session.post(f"{API}/wallet/topup", json={"amount": amount}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    ref = r.json()["reference"]
    r = session.post(f"{API}/wallet/topup/verify", params={"reference": ref}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    return r.json()["balance"]


def run_ride(session, rider_token, driver_token):
    r = session.post(
        f"{API}/rides",
        json={"vehicle_type": "car", "payment_method": "wallet", "pickup_address": "Yaba", "dropoff_address": "CMS", **LAGOS},
        headers={"Authorization": f"Bearer {rider_token}"},
    )
    assert r.status_code == 200, r.text
    ride = r.json()
    assert ride["status"] == "requested"
    for action in ("accept", "arrive", "start"):
        r = session.post(f"{API}/rides/{ride['ride_id']}/{action}", headers={"Authorization": f"Bearer {driver_token}"})
        assert r.status_code == 200, r.text
    r = session.post(f"{API}/rides/{ride['ride_id']}/complete", headers={"Authorization": f"Bearer {driver_token}"})
    assert r.status_code == 200, r.text
    return ride["ride_id"], ride["fare_estimate"], r.json()["trip_id"]


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


@pytest.fixture(scope="session")
def wallet_rider(session, state):
    acc = register(session, f"WALRIDER_{uuid.uuid4().hex[:4]}")
    state["wrider_token"] = acc["token"]
    state["wrider_id"] = acc["user"]["user_id"]
    return acc


@pytest.fixture(scope="session")
def wallet_driver(session, state):
    acc = make_verified_online_driver(session, f"WALDRIVER_{uuid.uuid4().hex[:4]}", plate=f"LAG-{uuid.uuid4().hex[:3].upper()}")
    state["wdriver_token"] = acc["token"]
    state["wdriver_id"] = acc["user"]["user_id"]
    return acc


@pytest.fixture(scope="session")
def wallet_admin(session, state):
    acc = register(session, f"WALADMIN_{uuid.uuid4().hex[:4]}")
    r = session.post(f"{API}/auth/dev/make-admin", json={"email": acc["email"]})
    assert r.status_code == 200, r.text
    state["wadmin_token"] = acc["token"]
    return acc


class TestWalletBasics:
    def test_wallet_empty(self, session, wallet_rider, state):
        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wrider_token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["balance"] == 0
        assert body["currency"] == "NGN"
        assert body["transactions"] == []

    def test_topup_init_creates_pending(self, session, wallet_rider, state):
        r = session.post(f"{API}/wallet/topup", json={"amount": 5000}, headers={"Authorization": f"Bearer {state['wrider_token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["payment_id"]
        assert body["reference"]
        assert body["authorization_url"]
        state["topup_ref"] = body["reference"]
        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wrider_token']}"})
        assert r.json()["balance"] == 0

    def test_topup_verify_credits(self, session, wallet_rider, state):
        r = session.post(
            f"{API}/wallet/topup/verify",
            params={"reference": state["topup_ref"]},
            headers={"Authorization": f"Bearer {state['wrider_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        assert r.json()["balance"] == 5000

    def test_topup_verify_idempotent(self, session, wallet_rider, state):
        r = session.post(
            f"{API}/wallet/topup/verify",
            params={"reference": state["topup_ref"]},
            headers={"Authorization": f"Bearer {state['wrider_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["balance"] == 5000

    def test_transactions_listed(self, session, wallet_rider, state):
        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wrider_token']}"})
        txns = r.json()["transactions"]
        assert any(t["category"] == "topup" and t["txn_type"] == "credit" and t["amount"] == 5000 for t in txns)


class TestRideSettlement:
    def test_wallet_ride_settles_both_sides(self, session, wallet_rider, wallet_driver, state):
        topup(session, state["wrider_token"], 10000)
        ride_id, fare, trip_id = run_ride(session, state["wrider_token"], state["wdriver_token"])
        state["wallet_fare"] = fare

        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wrider_token']}"})
        rider_balance = r.json()["balance"]
        assert rider_balance == pytest.approx(15000 - fare, abs=0.01)

        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        driver_balance = r.json()["balance"]
        assert driver_balance == pytest.approx(fare * 0.85, abs=0.01)
        state["driver_balance"] = driver_balance

        r = session.get(f"{API}/wallet/earnings", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        assert r.status_code == 200
        body = r.json()
        assert body["commission_percent"] == 15
        assert body["total_earnings"] == pytest.approx(fare * 0.85, abs=0.01)
        assert body["job_count"] == 1

    def test_earnings_ledger_lists_entries(self, session, wallet_driver, state):
        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        txns = r.json()["transactions"]
        assert any(t["category"] == "earnings" and t["txn_type"] == "credit" for t in txns)

    def test_insufficient_funds_blocks_completion(self, session, wallet_driver, state):
        broke = register(session, f"BROKE_{uuid.uuid4().hex[:4]}")
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", "payment_method": "wallet", **LAGOS},
            headers={"Authorization": f"Bearer {broke['token']}"},
        )
        assert r.status_code == 200, r.text
        ride = r.json()
        for action in ("accept", "arrive", "start"):
            r = session.post(f"{API}/rides/{ride['ride_id']}/{action}", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
            assert r.status_code == 200, r.text
        r = session.post(f"{API}/rides/{ride['ride_id']}/complete", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        assert r.status_code == 400
        assert "Insufficient" in r.json()["detail"]
        r = session.get(f"{API}/rides/{ride['ride_id']}", headers={"Authorization": f"Bearer {broke['token']}"})
        assert r.json()["status"] == "in_progress"


class TestWithdrawals:
    def test_withdraw_insufficient_rejected(self, session, wallet_rider, state):
        r = session.post(
            f"{API}/wallet/withdraw",
            json={"amount": 10**7, "bank_name": "GTB", "bank_account_name": "X", "bank_account_number": "0123456789"},
            headers={"Authorization": f"Bearer {state['wrider_token']}"},
        )
        assert r.status_code == 400

    def test_request_withdrawal(self, session, wallet_driver, state):
        amount = round(state["driver_balance"], 2)
        r = session.post(
            f"{API}/wallet/withdraw",
            json={"amount": amount, "bank_name": "GTB", "bank_account_name": "Driver", "bank_account_number": "0123456789"},
            headers={"Authorization": f"Bearer {state['wdriver_token']}"},
        )
        assert r.status_code == 200, r.text
        req = r.json()
        assert req["status"] == "pending"
        assert req["bank_name"] == "GTB"
        state["withdraw_id"] = req["request_id"]

        # Balance unchanged until payout.
        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        assert r.json()["balance"] == pytest.approx(amount, abs=0.01)

    def test_my_withdrawals_list(self, session, wallet_driver, state):
        r = session.get(f"{API}/wallet/withdrawals", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        assert r.status_code == 200
        assert any(w["request_id"] == state["withdraw_id"] for w in r.json())

    def test_admin_approve_then_pay(self, session, wallet_driver, wallet_admin, state):
        amount = round(state["driver_balance"], 2)
        headers = {"Authorization": f"Bearer {state['wadmin_token']}"}

        r = session.get(f"{API}/admin/withdrawals", headers=headers)
        assert r.status_code == 200
        assert any(w["request_id"] == state["withdraw_id"] and w["status"] == "pending" for w in r.json())

        r = session.post(f"{API}/admin/withdrawals/{state['withdraw_id']}/review", json={"decision": "approved"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"

        r = session.post(f"{API}/admin/withdrawals/{state['withdraw_id']}/review", json={"decision": "paid", "note": "transferred"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "paid"

        r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {state['wdriver_token']}"})
        assert r.json()["balance"] == pytest.approx(0, abs=0.01)

    def test_non_admin_cannot_review(self, session, wallet_rider, state):
        r = session.get(f"{API}/admin/withdrawals", headers={"Authorization": f"Bearer {state['wrider_token']}"})
        assert r.status_code == 403

    def test_withdraw_after_paid_rejected(self, session, wallet_driver, wallet_admin, state):
        r = session.post(
            f"{API}/admin/withdrawals/{state['withdraw_id']}/review",
            json={"decision": "approved"},
            headers={"Authorization": f"Bearer {state['wadmin_token']}"},
        )
        assert r.status_code == 400
