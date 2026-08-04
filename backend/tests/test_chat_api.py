"""End-to-end tests for rider-driver ride chat.
Run: pytest tests/test_chat_api.py -v   (backend server must be running)
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
    acc = register(session, f"CHAT_{uuid.uuid4().hex[:4]}")
    state["s_rider"] = acc["token"]
    state["s_rider_id"] = acc["user"]["user_id"]
    return acc


@pytest.fixture(scope="session")
def s_driver(session, state):
    acc = make_verified_online_driver(session, f"CHATD_{uuid.uuid4().hex[:4]}")
    state["s_driver"] = acc["token"]
    state["s_driver_id"] = acc["user"]["user_id"]
    return acc


@pytest.fixture(scope="session")
def s_other(session, state):
    acc = register(session, f"CHATO_{uuid.uuid4().hex[:4]}")
    state["s_other"] = acc["token"]
    return acc


def make_active_ride(session, state):
    r = session.post(f"{API}/rides", json={"vehicle_type": "car", **LAGOS}, headers={"Authorization": f"Bearer {state['s_rider']}"})
    assert r.status_code == 200, r.text
    ride_id = r.json()["ride_id"]
    r = session.post(f"{API}/rides/{ride_id}/accept", headers={"Authorization": f"Bearer {state['s_driver']}"})
    assert r.status_code == 200, r.text
    return ride_id


class TestChatHistory:
    def test_empty_history(self, session, state, s_rider, s_driver):
        ride_id = make_active_ride(session, state)
        state["chat_ride_id"] = ride_id
        r = session.get(f"{API}/rides/{ride_id}/messages", headers={"Authorization": f"Bearer {state['s_rider']}"})
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_history_forbidden_for_stranger(self, session, s_other, state, s_rider, s_driver):
        r = session.get(f"{API}/rides/{state['chat_ride_id']}/messages", headers={"Authorization": f"Bearer {state['s_other']}"})
        assert r.status_code == 403

    def test_history_requires_auth(self, session, state, s_rider, s_driver):
        r = session.get(f"{API}/rides/{state['chat_ride_id']}/messages")
        assert r.status_code == 401


class TestSendMessage:
    def test_rider_sends_driver_receives(self, session, state, s_rider, s_driver):
        r = session.post(
            f"{API}/rides/{state['chat_ride_id']}/messages",
            json={"body": "Good evening, I'm at the main gate"},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sender_id"] == state["s_rider_id"]
        assert body["recipient_id"] == state["s_driver_id"]
        assert body["body"] == "Good evening, I'm at the main gate"
        state["msg_1"] = body["message_id"]

        r = session.get(f"{API}/rides/{state['chat_ride_id']}/messages", headers={"Authorization": f"Bearer {state['s_driver']}"})
        assert r.status_code == 200, r.text
        msgs = r.json()
        assert len(msgs) == 1
        assert msgs[0]["message_id"] == state["msg_1"]

    def test_driver_replies_rider_sees(self, session, state, s_rider, s_driver):
        r = session.post(
            f"{API}/rides/{state['chat_ride_id']}/messages",
            json={"body": "On my way, 2 minutes out"},
            headers={"Authorization": f"Bearer {state['s_driver']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["recipient_id"] == state["s_rider_id"]

        r = session.get(f"{API}/rides/{state['chat_ride_id']}/messages", headers={"Authorization": f"Bearer {state['s_rider']}"})
        msgs = r.json()
        assert len(msgs) == 2
        assert msgs[0]["sender_id"] == state["s_rider_id"]
        assert msgs[1]["sender_id"] == state["s_driver_id"]

    def test_empty_message_rejected(self, session, state, s_rider, s_driver):
        r = session.post(
            f"{API}/rides/{state['chat_ride_id']}/messages",
            json={"body": "   "},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 400

    def test_stranger_cannot_send(self, session, s_other, state, s_rider, s_driver):
        r = session.post(
            f"{API}/rides/{state['chat_ride_id']}/messages",
            json={"body": "hey"},
            headers={"Authorization": f"Bearer {state['s_other']}"},
        )
        assert r.status_code == 403

    def test_chat_on_unknown_ride(self, session, state, s_rider, s_driver):
        r = session.post(
            f"{API}/rides/doesnotexist/messages",
            json={"body": "hey"},
            headers={"Authorization": f"Bearer {state['s_rider']}"},
        )
        assert r.status_code == 404
