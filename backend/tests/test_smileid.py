"""Unit tests for the SmileID driver identity-check orchestrator.

These test the orchestration logic (dev stub fallback, Enhanced KYC +
SmartSelfie Compare gating, reference building) with the HTTP layer mocked.
Run: pytest tests/test_smileid.py -q   (no backend server or credentials needed)
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.driver import DriverProfile
from app.models.user import User
from app.services import smileid


def make_profile(**overrides) -> DriverProfile:
    base = {
        "user_id": "u_test1234",
        "id_type": "nin",
        "id_number": "12345678901",
        "license_number": "NG-12345",
        "document_urls": '["/uploads/id_photo.jpg"]',
    }
    base.update(overrides)
    return DriverProfile(**base)


def make_user() -> User:
    return User(user_id="u_test1234", name="John Doe", email="john@example.com")


def test_dev_stub_passes_when_not_configured(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: False)
    status, ref, message = asyncio.run(smileid.run_driver_identity_check(make_profile(), make_user(), "/uploads/selfie.jpg"))
    assert status == "passed"
    assert ref.startswith("liveness_")


def test_dev_stub_rejects_missing_selfie(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: False)
    status, ref, message = asyncio.run(smileid.run_driver_identity_check(make_profile(), make_user(), ""))
    assert status == "failed"


def test_requires_id_document_before_provider_check(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: True)
    profile = make_profile(document_urls=None)
    status, ref, message = asyncio.run(smileid.run_driver_identity_check(profile, make_user(), "/uploads/selfie.jpg"))
    assert status == "failed"
    assert "Upload your ID document first" in message


def test_passes_when_kyc_and_compare_clear(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: True)
    monkeypatch.setattr(smileid, "_read_image", lambda url: b"\xff\xd8\xff" + url.encode())

    async def fake_kyc(user, id_type, id_number):
        return "job_kyc123"

    async def fake_compare(user, selfie, compare):
        return "job_ssc456"

    async def fake_poll(job_id):
        return ("clear", "OK")

    monkeypatch.setattr(smileid, "submit_enhanced_kyc", fake_kyc)
    monkeypatch.setattr(smileid, "submit_smart_selfie_compare", fake_compare)
    monkeypatch.setattr(smileid, "poll_status", fake_poll)

    status, ref, message = asyncio.run(smileid.run_driver_identity_check(make_profile(), make_user(), "/uploads/selfie.jpg"))
    assert status == "passed"
    assert "kyc:job_kyc123:clear" in ref
    assert "compare:job_ssc456:clear" in ref


def test_fails_when_id_number_not_confirmed(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: True)
    monkeypatch.setattr(smileid, "_read_image", lambda url: b"img")

    async def fake_kyc(user, id_type, id_number):
        return "job_kyc123"

    async def fake_compare(user, selfie, compare):
        return "job_ssc456"

    async def fake_poll(job_id):
        return ("block", "no match")

    monkeypatch.setattr(smileid, "submit_enhanced_kyc", fake_kyc)
    monkeypatch.setattr(smileid, "submit_smart_selfie_compare", fake_compare)
    monkeypatch.setattr(smileid, "poll_status", fake_poll)

    status, ref, message = asyncio.run(smileid.run_driver_identity_check(make_profile(), make_user(), "/uploads/selfie.jpg"))
    assert status == "failed"
    assert "could not be confirmed" in message


def test_skips_kyc_for_unsupported_id_type(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: True)
    monkeypatch.setattr(smileid, "_read_image", lambda url: b"img")
    submitted = []

    async def fake_compare(user, selfie, compare):
        submitted.append(1)
        return "job_ssc789"

    async def fake_poll(job_id):
        return ("clear", "OK")

    monkeypatch.setattr(smileid, "submit_smart_selfie_compare", fake_compare)
    monkeypatch.setattr(smileid, "poll_status", fake_poll)

    profile = make_profile(id_type="driver_license", id_number=None)
    status, ref, message = asyncio.run(smileid.run_driver_identity_check(profile, make_user(), "/uploads/selfie.jpg"))
    assert status == "passed"
    assert len(submitted) == 1
    assert "kyc:" not in ref


def test_provider_failure_is_fail_closed(monkeypatch):
    monkeypatch.setattr(smileid, "_configured", lambda: True)
    monkeypatch.setattr(smileid, "_read_image", lambda url: b"img")

    async def boom(user, id_type, id_number):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(smileid, "submit_enhanced_kyc", boom)
    status, ref, message = asyncio.run(smileid.run_driver_identity_check(make_profile(), make_user(), "/uploads/selfie.jpg"))
    assert status == "failed"
    assert "temporarily unavailable" in message
