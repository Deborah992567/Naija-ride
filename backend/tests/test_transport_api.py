"""End-to-end API tests for Public Transport Tracker backend.
Run: pytest /app/backend/tests/test_transport_api.py -v
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://bus-tracker-hub-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- shared session / state ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def fresh_user():
    rid = uuid.uuid4().hex[:8]
    return {
        "email": f"TEST_pt_{rid}@example.com",
        "password": "pass1234",
        "name": f"TEST User {rid}",
    }


@pytest.fixture(scope="session")
def state():
    return {}


# ---------- AUTH ----------
class TestAuth:
    def test_health(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_register(self, session, fresh_user, state):
        r = session.post(f"{API}/auth/register", json=fresh_user)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and "user" in body
        assert body["user"]["email"] == fresh_user["email"].lower()
        assert body["user"]["provider"] == "password"
        assert body["user"]["karma"] == 0
        state["token"] = body["token"]
        state["user_id"] = body["user"]["user_id"]

    def test_register_duplicate(self, session, fresh_user):
        r = session.post(f"{API}/auth/register", json=fresh_user)
        assert r.status_code == 400

    def test_login(self, session, fresh_user, state):
        r = session.post(f"{API}/auth/login", json={
            "email": fresh_user["email"],
            "password": fresh_user["password"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == fresh_user["email"].lower()
        state["token"] = body["token"]

    def test_login_bad_password(self, session, fresh_user):
        r = session.post(f"{API}/auth/login", json={
            "email": fresh_user["email"], "password": "wrongpass"
        })
        assert r.status_code == 401

    def test_me(self, session, state, fresh_user):
        r = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == fresh_user["email"].lower()
        assert body["user_id"] == state["user_id"]

    def test_me_invalid_token(self, session):
        r = session.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-token"})
        assert r.status_code == 401

    def test_me_missing_token(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_google_session_invalid(self, session):
        r = session.post(f"{API}/auth/google-session", json={"session_id": "invalid_xyz"})
        # Should reject with 401 (or 502 if provider unreachable)
        assert r.status_code in (401, 502)


# ---------- ROUTES ----------
class TestRoutes:
    def test_list_routes_has_seed(self, session, state):
        r = session.get(f"{API}/routes")
        assert r.status_code == 200
        routes = r.json()
        assert isinstance(routes, list)
        assert len(routes) >= 4, f"expected >=4 seeded routes, got {len(routes)}"
        cities = {x["city"] for x in routes}
        assert {"Lagos", "Abuja", "Port Harcourt", "Campus"}.issubset(cities), cities
        state["routes"] = routes
        state["route"] = next(x for x in routes if x["city"] == "Lagos")

    def test_get_route_detail(self, session, state):
        rid = state["route"]["route_id"]
        r = session.get(f"{API}/routes/{rid}")
        assert r.status_code == 200
        body = r.json()
        assert body["route_id"] == rid
        assert len(body["stops"]) > 0
        # stops have lat/lng
        s0 = body["stops"][0]
        assert "lat" in s0 and "lng" in s0

    def test_get_route_404(self, session):
        r = session.get(f"{API}/routes/rt_does_not_exist")
        assert r.status_code == 404


# ---------- REPORTS / VEHICLES / ETA ----------
class TestReportsAndEta:
    def test_submit_report_increments_karma(self, session, state):
        route = state["route"]
        stop = route["stops"][0]
        token = state["token"]
        body = {
            "route_id": route["route_id"],
            "type": "sighting",
            "vehicle_type": route["vehicle_type"],
            "lat": stop["lat"],
            "lng": stop["lng"],
            "crowd_level": "moderate",
            "note": "TEST sighting",
        }
        r = session.post(f"{API}/reports", json=body,
                         headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["route_id"] == route["route_id"]
        assert rep["user_id"] == state["user_id"]
        state["report_id"] = rep["report_id"]

        # verify karma incremented via /auth/me
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
        assert me["karma"] >= 1, f"karma not incremented: {me}"

    def test_submit_report_unauthorized(self, session, state):
        route = state["route"]
        stop = route["stops"][0]
        r = session.post(f"{API}/reports", json={
            "route_id": route["route_id"], "type": "sighting",
            "vehicle_type": route["vehicle_type"], "lat": stop["lat"], "lng": stop["lng"],
        })
        assert r.status_code == 401

    def test_submit_report_invalid_route(self, session, state):
        token = state["token"]
        r = session.post(f"{API}/reports", json={
            "route_id": "rt_nope", "type": "sighting",
            "vehicle_type": "bus", "lat": 0, "lng": 0,
        }, headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 404

    def test_live_vehicles_contains_recent(self, session, state):
        # Allow a moment for DB write to propagate
        time.sleep(0.5)
        r = session.get(f"{API}/vehicles/live?minutes=15")
        assert r.status_code == 200
        live = r.json()
        assert isinstance(live, list)
        ids = [x["report_id"] for x in live]
        assert state["report_id"] in ids, f"recent report missing from live list (ids={ids[:3]}...)"

    def test_eta_after_recent_report(self, session, state):
        route = state["route"]
        r = session.get(f"{API}/eta", params={"route_id": route["route_id"], "stop_id": 0})
        assert r.status_code == 200
        eta = r.json()
        assert eta["confidence"] in ("high", "medium", "low")
        assert eta["distance_km"] is not None
        assert eta["last_seen_minutes_ago"] is not None
        assert eta["eta_minutes"] is not None
        assert isinstance(eta["eta_minutes"], int)

    def test_eta_invalid_stop(self, session, state):
        rid = state["route"]["route_id"]
        r = session.get(f"{API}/eta", params={"route_id": rid, "stop_id": 999})
        assert r.status_code == 400

    def test_logout(self, session, state):
        token = state["token"]
        r = session.post(f"{API}/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------- NEW FEATURES: password reset, follows, notifications, analytics, moderation ----------
class TestPasswordReset:
    def test_forgot_generates_token(self, session, fresh_user, state):
        r = session.post(f"{API}/auth/forgot", json={"email": fresh_user["email"]})
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert body.get("reset_token"), "dev build should return the reset token"
        state["reset_token"] = body["reset_token"]

    def test_reset_password_and_login(self, session, fresh_user, state):
        r = session.post(f"{API}/auth/reset", json={"token": state["reset_token"], "password": "brandnew1"})
        assert r.status_code == 200, r.text
        # old password rejected
        old = session.post(f"{API}/auth/login", json={"email": fresh_user["email"], "password": fresh_user["password"]})
        assert old.status_code == 401
        new = session.post(f"{API}/auth/login", json={"email": fresh_user["email"], "password": "brandnew1"})
        assert new.status_code == 200

    def test_reset_reuse_token_fails(self, session, state):
        r = session.post(f"{API}/auth/reset", json={"token": state["reset_token"], "password": "whatever1"})
        assert r.status_code == 400


class TestCooldown:
    def test_duplicate_report_rate_limited(self, session, state):
        # Use a route the shared test user has NOT reported recently (the
        # karma test used the Lagos route), so the first submit is fresh.
        route = next(x for x in state["routes"] if x["city"] == "Campus")
        stop = route["stops"][0]
        token = state["token"]
        payload = {
            "route_id": route["route_id"], "type": "sighting",
            "vehicle_type": route["vehicle_type"], "lat": stop["lat"], "lng": stop["lng"],
        }
        first = session.post(f"{API}/reports", json=payload, headers={"Authorization": f"Bearer {token}"})
        assert first.status_code == 200, first.text
        second = session.post(f"{API}/reports", json=payload, headers={"Authorization": f"Bearer {token}"})
        assert second.status_code == 429, f"expected 429 cooldown, got {second.status_code}: {second.text}"


class TestFollowsAndNotifications:
    def test_push_token_register(self, session, state):
        r = session.post(f"{API}/me/push-token", json={"push_token": "ExponentPushToken[test_token]"}, headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200

    def test_follow_route(self, session, state):
        rid = state["route"]["route_id"]
        r = session.post(f"{API}/follows/{rid}", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200
        assert r.json()["route_id"] == rid

    def test_list_follows(self, session, state):
        r = session.get(f"{API}/follows", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200
        ids = [f["route_id"] for f in r.json()]
        assert state["route"]["route_id"] in ids

    def test_unfollow_route(self, session, state):
        rid = state["route"]["route_id"]
        r = session.delete(f"{API}/follows/{rid}", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200

    def test_follow_invalid_route(self, session, state):
        r = session.post(f"{API}/follows/rt_nope", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 404


class TestAnalytics:
    def test_crowd_analytics(self, session, state):
        rid = state["route"]["route_id"]
        r = session.get(f"{API}/analytics/crowd", params={"route_id": rid, "days": 3})
        assert r.status_code == 200
        body = r.json()
        assert body["route_id"] == rid
        assert len(body["by_hour"]) == 24
        assert all(h["report_count"] >= 0 for h in body["by_hour"])

    def test_crowd_analytics_invalid_route(self, session):
        r = session.get(f"{API}/analytics/crowd", params={"route_id": "rt_nope"})
        assert r.status_code == 404


class TestModeration:
    def _submit_own_report(self, session, state, city):
        """Create a fresh report owned by the shared test user on a given city's route."""
        route = next(x for x in state["routes"] if x["city"] == city)
        stop = route["stops"][0]
        rep = session.post(f"{API}/reports", json={
            "route_id": route["route_id"], "type": "sighting",
            "vehicle_type": route["vehicle_type"], "lat": stop["lat"], "lng": stop["lng"],
            "crowd_level": "moderate",
        }, headers={"Authorization": f"Bearer {state['token']}"})
        assert rep.status_code == 200, rep.text
        return rep.json()["report_id"]

    def test_flag_report(self, session, state):
        target = self._submit_own_report(session, state, "Abuja")
        r = session.post(f"{API}/reports/{target}/flag", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200
        assert r.json()["status"] == "flagged"
        # flagged report should be absent from any public listing
        all_visible = session.get(f"{API}/reports", params={"minutes": 30}).json()
        assert all(x["report_id"] != target for x in all_visible), "flagged report should be hidden"

    def test_delete_report(self, session, state):
        target = self._submit_own_report(session, state, "Port Harcourt")
        r = session.delete(f"{API}/reports/{target}", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 200
        again = session.delete(f"{API}/reports/{target}", headers={"Authorization": f"Bearer {state['token']}"})
        assert again.status_code == 404

    def test_delete_foreign_report_forbidden(self, session, state):
        # register (or log back in to) a second user and submit a report with them
        email = "other_user_x@example.com"
        second = session.post(f"{API}/auth/register", json={"email": email, "password": "pass1234"})
        if second.status_code == 400:
            second = session.post(f"{API}/auth/login", json={"email": email, "password": "pass1234"})
        assert second.status_code == 200, second.text
        token2 = second.json()["token"]
        # The second user may hit the report cooldown on a repeated run, so try
        # a few routes until one succeeds.
        stop = state["route"]["stops"][0]
        report_resp = None
        for candidate in state["routes"]:
            report_resp = session.post(f"{API}/reports", json={
                "route_id": candidate["route_id"], "type": "sighting",
                "vehicle_type": candidate["vehicle_type"],
                "lat": candidate["stops"][0]["lat"], "lng": candidate["stops"][0]["lng"],
            }, headers={"Authorization": f"Bearer {token2}"})
            if report_resp.status_code == 200:
                break
        assert report_resp is not None and report_resp.status_code == 200, report_resp.text
        rep = report_resp.json()
        # first user (not owner) cannot delete
        r = session.delete(f"{API}/reports/{rep['report_id']}", headers={"Authorization": f"Bearer {state['token']}"})
        assert r.status_code == 403
