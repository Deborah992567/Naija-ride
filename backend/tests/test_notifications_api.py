"""End-to-end tests for notifications (in-app + push wiring).
Run: pytest tests/test_notifications_api.py -v   (backend server must be running)
"""
import os
import pytest
import requests

from conftest import register

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
def notif_rider(session, state):
    acc = register(session, "NOTIF")
    state["nrider_token"] = acc["token"]
    return acc


@pytest.fixture(scope="session")
def notif_driver(session, state):
    from conftest import make_verified_online_driver

    acc = make_verified_online_driver(session, "NOTIFD")
    state["ndriver_token"] = acc["token"]
    return acc


class TestNotificationsEmpty:
    def test_empty_list(self, session, notif_rider, state):
        r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_zero_unread(self, session, notif_rider, state):
        r = session.get(f"{API}/notifications/unread-count", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.status_code == 200
        assert r.json()["count"] == 0


class TestLifecycleNotifications:
    def test_accept_creates_notification(self, session, notif_rider, notif_driver, state):
        r = session.post(
            f"{API}/rides",
            json={"vehicle_type": "car", **LAGOS},
            headers={"Authorization": f"Bearer {state['nrider_token']}"},
        )
        assert r.status_code == 200, r.text
        state["nride_id"] = r.json()["ride_id"]

        r = session.post(f"{API}/rides/{state['nride_id']}/accept", headers={"Authorization": f"Bearer {state['ndriver_token']}"})
        assert r.status_code == 200, r.text

        r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.status_code == 200
        body = r.json()
        assert any(n["category"] == "ride" and "accepted" in n["title"].lower() for n in body)

    def test_complete_creates_notification(self, session, notif_rider, notif_driver, state):
        for action in ("arrive", "start"):
            r = session.post(f"{API}/rides/{state['nride_id']}/{action}", headers={"Authorization": f"Bearer {state['ndriver_token']}"})
            assert r.status_code == 200, r.text
        r = session.post(f"{API}/rides/{state['nride_id']}/complete", headers={"Authorization": f"Bearer {state['ndriver_token']}"})
        assert r.status_code == 200, r.text

        r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        body = r.json()
        assert any(n["category"] == "ride" and "complete" in n["title"].lower() for n in body)


class TestMarkRead:
    def test_unread_count_after_events(self, session, notif_rider, state):
        r = session.get(f"{API}/notifications/unread-count", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.json()["count"] >= 2

    def test_mark_one_read(self, session, notif_rider, state):
        r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        nid = r.json()[0]["notification_id"]
        r = session.post(f"{API}/notifications/{nid}/read", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["read"] is True

    def test_mark_all_read(self, session, notif_rider, state):
        r = session.post(f"{API}/notifications/read-all", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        assert r.json()["marked"] >= 1

    def test_unread_count_zero(self, session, notif_rider, state):
        r = session.get(f"{API}/notifications/unread-count", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        assert r.json()["count"] == 0

    def test_other_users_notification_forbidden(self, session, notif_rider, notif_driver, state):
        r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {state['nrider_token']}"})
        nid = r.json()[0]["notification_id"]
        r = session.post(f"{API}/notifications/{nid}/read", headers={"Authorization": f"Bearer {state['ndriver_token']}"})
        assert r.status_code == 403
