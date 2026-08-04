"""End-to-end tests for driver verification.
Run: pytest tests/test_verification_api.py -v   (backend server must be running)
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


@pytest.fixture(scope="session")
def admin(session, state):
    acc = register(session, "ADMIN")
    r = session.post(f"{API}/auth/dev/make-admin", json={"email": acc["email"]})
    assert r.status_code == 200, r.text
    state["admin_token"] = acc["token"]
    return acc


@pytest.fixture(scope="session")
def verify_driver(session, state):
    acc = register(session, "VD")
    r = session.post(
        f"{API}/drivers/register",
        json={"vehicle_type": "car", "vehicle_plate": "VFR-001", "phone": "08011112222"},
        headers={"Authorization": f"Bearer {acc['token']}"},
    )
    assert r.status_code == 200, r.text
    state["vd_token"] = acc["token"]
    state["vd_id"] = acc["user"]["user_id"]
    return acc


@pytest.fixture(scope="session")
def reject_driver(session, state):
    acc = register(session, "REJ")
    r = session.post(
        f"{API}/drivers/register",
        json={"vehicle_type": "bike", "vehicle_plate": "BIK-002", "phone": "08022223333"},
        headers={"Authorization": f"Bearer {acc['token']}"},
    )
    assert r.status_code == 200, r.text
    state["reject_token"] = acc["token"]
    state["reject_id"] = acc["user"]["user_id"]
    return acc


class TestSubmission:
    def test_unverified_cannot_go_online(self, session, verify_driver, state):
        r = session.post(
            f"{API}/drivers/status",
            json={"is_online": True, "lat": 6.51, "lng": 3.37},
            headers={"Authorization": f"Bearer {state['vd_token']}"},
        )
        assert r.status_code == 403

    def test_initial_status_unverified(self, session, verify_driver, state):
        r = session.get(f"{API}/drivers/verification", headers={"Authorization": f"Bearer {state['vd_token']}"})
        assert r.status_code == 200, r.text
        assert r.json()["verification_status"] == "unverified"

    def test_submit_verification(self, session, verify_driver, state):
        r = session.post(
            f"{API}/drivers/verification",
            json={
                "id_type": "national_id",
                "id_number": "1234567890",
                "license_number": "DL-9988",
                "license_expiry": "2030-01-01",
                "profile_photo": "https://example.com/photo.jpg",
                "document_urls": ["https://example.com/id.jpg", "https://example.com/selfie.jpg"],
            },
            headers={"Authorization": f"Bearer {state['vd_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verification_status"] == "pending"
        assert len(body["document_urls"]) == 2
        assert body["license_number"] == "DL-9988"

    def test_non_driver_cannot_submit(self, session):
        acc = register(session, "NOTDRIVER")
        r = session.post(
            f"{API}/drivers/verification",
            json={"id_type": "nin", "id_number": "X"},
            headers={"Authorization": f"Bearer {acc['token']}"},
        )
        assert r.status_code == 404


class TestAdminReview:
    def test_non_admin_forbidden(self, session, verify_driver, state):
        r = session.get(f"{API}/admin/drivers/verifications", headers={"Authorization": f"Bearer {state['vd_token']}"})
        assert r.status_code == 403

    def test_admin_list_pending(self, session, admin, verify_driver, reject_driver, state):
        r = session.get(f"{API}/admin/drivers/verifications", headers={"Authorization": f"Bearer {state['admin_token']}"})
        assert r.status_code == 200, r.text
        ids = {d["user_id"] for d in r.json()}
        assert state["vd_id"] in ids

    def test_admin_approve(self, session, admin, verify_driver, state):
        r = session.post(
            f"{API}/admin/drivers/{state['vd_id']}/verify",
            json={"decision": "verified", "note": "All documents OK"},
            headers={"Authorization": f"Bearer {state['admin_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verification_status"] == "verified"
        assert body["email"].startswith("vd_")

    def test_verified_can_go_online(self, session, verify_driver, state):
        r = session.post(
            f"{API}/drivers/status",
            json={"is_online": True, "lat": 6.51, "lng": 3.37},
            headers={"Authorization": f"Bearer {state['vd_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_online"] == 1

    def test_admin_reject(self, session, admin, reject_driver, state):
        r = session.post(
            f"{API}/drivers/verification",
            json={"id_type": "nin", "id_number": "9988776655"},
            headers={"Authorization": f"Bearer {state['reject_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["verification_status"] == "pending"

        r = session.post(
            f"{API}/admin/drivers/{state['reject_id']}/verify",
            json={"decision": "rejected", "note": "Blurry document, resubmit"},
            headers={"Authorization": f"Bearer {state['admin_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["verification_status"] == "rejected"

        r = session.get(f"{API}/drivers/verification", headers={"Authorization": f"Bearer {state['reject_token']}"})
        assert r.json()["verification_status"] == "rejected"
        assert "Blurry" in (r.json()["verification_note"] or "")

    def test_rejected_cannot_go_online(self, session, reject_driver, state):
        r = session.post(
            f"{API}/drivers/status",
            json={"is_online": True, "lat": 6.51, "lng": 3.37},
            headers={"Authorization": f"Bearer {state['reject_token']}"},
        )
        assert r.status_code == 403
