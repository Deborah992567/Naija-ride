"""End-to-end tests for the referral program.
Run: pytest tests/test_referrals_api.py -v   (backend server must be running)
"""
import os
import uuid

import pytest
import requests

from conftest import register

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


def test_register_assigns_referral_code(session):
    acc = register(session, "REFCODE")
    assert acc["user"].get("referral_code"), "user should get an invite code on signup"
    assert len(acc["user"]["referral_code"]) >= 8


def test_referrals_show_own_code(session, state):
    acc = register(session, "REFOWN")
    state["owner"] = acc
    r = session.get(f"{API}/referrals", headers={"Authorization": f"Bearer {acc['token']}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["referral_code"] == acc["user"]["referral_code"]
    assert body["referrals"] == []
    assert body["total_rewards"] == 0
    assert body["referrer_reward"] == 500
    assert body["referred_reward"] == 300


def test_apply_referral_rewards_both(session, state):
    owner = state["owner"]
    friend = register(session, "REFFRIEND")
    r = session.post(
        f"{API}/referrals/apply",
        json={"code": owner["user"]["referral_code"]},
        headers={"Authorization": f"Bearer {friend['token']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reward"] == 300

    r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {owner['token']}"})
    assert r.json()["balance"] == 500
    r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {friend['token']}"})
    assert r.json()["balance"] == 300

    r = session.get(f"{API}/referrals", headers={"Authorization": f"Bearer {owner['token']}"})
    body = r.json()
    assert body["total_rewards"] == 500
    assert any(x["user_id"] == friend["user"]["user_id"] for x in body["referrals"])


def test_register_with_referral_code_rewards(session, state):
    owner = state["owner"]
    r = session.post(
        f"{API}/auth/register",
        json={"email": f"REFSIGNUP_{uuid.uuid4().hex[:6]}@example.com", "password": "pass1234", "referral_code": owner["user"]["referral_code"]},
    )
    assert r.status_code == 200, r.text
    r = session.get(f"{API}/wallet", headers={"Authorization": f"Bearer {r.json()['token']}"})
    assert r.json()["balance"] == 300


def test_cannot_reapply_referral(session, state):
    friend = register(session, "REFAGAIN")
    r = session.post(
        f"{API}/referrals/apply",
        json={"code": state["owner"]["user"]["referral_code"]},
        headers={"Authorization": f"Bearer {friend['token']}"},
    )
    assert r.status_code == 200, r.text
    r = session.post(
        f"{API}/referrals/apply",
        json={"code": state["owner"]["user"]["referral_code"]},
        headers={"Authorization": f"Bearer {friend['token']}"},
    )
    assert r.status_code == 400, r.text
    assert "already" in r.json()["detail"].lower()


def test_cannot_use_own_code(session, state):
    r = session.post(
        f"{API}/referrals/apply",
        json={"code": state["owner"]["user"]["referral_code"]},
        headers={"Authorization": f"Bearer {state['owner']['token']}"},
    )
    assert r.status_code == 400, r.text


def test_unknown_code_404(session):
    acc = register(session, "REFBAD")
    r = session.post(f"{API}/referrals/apply", json={"code": "ZZZZZZZZ"}, headers={"Authorization": f"Bearer {acc['token']}"})
    assert r.status_code == 404, r.text


def test_referral_notifications_created(session, state):
    friend = register(session, "REFNOTIF")
    r = session.post(
        f"{API}/referrals/apply",
        json={"code": state["owner"]["user"]["referral_code"]},
        headers={"Authorization": f"Bearer {friend['token']}"},
    )
    assert r.status_code == 200, r.text
    r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {friend['token']}"})
    assert any(n["category"] == "referral" for n in r.json())
