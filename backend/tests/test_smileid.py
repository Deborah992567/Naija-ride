"""Unit tests for the SmileID NIN/BVN Enhanced KYC client.

The liveness/face-match orchestrator moved in-house to `services.biometric`;
SmileID now only cross-checks government ID numbers. HTTP is mocked here.
Run: pytest tests/test_smileid.py -q   (no server or credentials needed)
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.user import User
from app.services import smileid

USER = User(user_id="u_test1234", name="John Doe", email="john@example.com")


def _patch_token(monkeypatch, token="tok_abc"):
    async def fake_get_token():
        return token

    monkeypatch.setattr(smileid, "get_token", fake_get_token)


def test_token_is_cached_and_refreshed(monkeypatch):
    monkeypatch.setattr(smileid, "_token_cache", {"token": None, "expires_at": 0.0})
    hits = {"n": 0}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            hits["n"] += 1

            class Resp:
                status_code = 200

                def raise_for_status(self):
                    return None

                def json(self):
                    return {"token": f"tok_{hits['n']}"}

            return Resp()

    monkeypatch.setattr(smileid.httpx, "AsyncClient", FakeClient)
    first = asyncio.run(smileid.get_token())
    second = asyncio.run(smileid.get_token())
    assert first == "tok_1" and second == "tok_1"  # cached: no second HTTP call
    assert hits["n"] == 1


def test_submit_enhanced_kyc_builds_fields_and_returns_job_id(monkeypatch):
    _patch_token(monkeypatch)
    captured = {}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["data"] = data

            class Resp:
                status_code = 200

                def raise_for_status(self):
                    return None

                def json(self):
                    return {"job_id": "job_kyc999"}

            return Resp()

    monkeypatch.setattr(smileid.httpx, "AsyncClient", FakeClient)
    job = asyncio.run(smileid.submit_enhanced_kyc(USER, "NIN_V2", "12345678901"))
    assert job == "job_kyc999"
    assert captured["url"].endswith("/v3/enhanced_kyc")
    assert captured["headers"]["SmileID-Token"] == "tok_abc"
    import json

    params = json.loads(captured["data"]["partner_params"])
    assert params["job_type"] == "5"


def test_enhanced_kyc_raises_when_no_job_id(monkeypatch):
    _patch_token(monkeypatch)

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            class Resp:
                status_code = 200

                def raise_for_status(self):
                    return None

                def json(self):
                    return {"result": "no job"}

            return Resp()

    monkeypatch.setattr(smileid.httpx, "AsyncClient", FakeClient)
    try:
        asyncio.run(smileid.submit_enhanced_kyc(USER, "NIN_V2", "123"))
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "job_id" in str(exc)


def test_poll_returns_terminal_verdict(monkeypatch):
    _patch_token(monkeypatch)

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            class Resp:
                status_code = 200

                def json(self):
                    return {"status": "clear", "message": "Verified"}

            return Resp()

    monkeypatch.setattr(smileid.httpx, "AsyncClient", FakeClient)
    status, message = asyncio.run(smileid.poll_status("job_x", timeout=2))
    assert status == "clear"


def test_poll_waits_on_202_then_returns_terminal(monkeypatch):
    _patch_token(monkeypatch)
    calls = {"n": 0}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            calls["n"] += 1

            class Resp:
                status_code = 202 if calls["n"] == 1 else 200
                ok = True

                def json(self):
                    return {"status": "processing"} if calls["n"] == 1 else {"status": "block", "message": "Rejected"}

            return Resp()

    monkeypatch.setattr(smileid.httpx, "AsyncClient", FakeClient)

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(smileid.asyncio, "sleep", no_sleep)
    status, message = asyncio.run(smileid.poll_status("job_y", timeout=2))
    assert status == "block"
    assert calls["n"] == 2


def test_poll_404_is_block(monkeypatch):
    _patch_token(monkeypatch)

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            class Resp:
                status_code = 404

            return Resp()

    monkeypatch.setattr(smileid.httpx, "AsyncClient", FakeClient)
    status, _ = asyncio.run(smileid.poll_status("job_z", timeout=2))
    assert status == "block"


def test_configured_gates_on_credentials(monkeypatch):
    monkeypatch.setattr(smileid, "SMILEDID_PARTNER_ID", "pid")
    monkeypatch.setattr(smileid, "SMILEDID_API_KEY", "")
    assert smileid._configured() is False
    monkeypatch.setattr(smileid, "SMILEDID_API_KEY", "key")
    assert smileid._configured() is True
