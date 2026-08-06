"""Unit tests for the in-house biometric engine (liveness + face match).

The ONNX model layer is mocked so these run anywhere; the real YuNet/SFace
pipeline is exercised by the live smoke test against real uploads.
Run: pytest tests/test_biometric.py -q
"""
import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest

from app.models.driver import DriverProfile
from app.models.user import User
from app.services import biometric, smileid


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


def norm(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def test_face_similarity_identical_is_one():
    a = norm(np.ones(128))
    assert biometric.face_similarity(a, a) == pytest.approx(1.0)


def test_face_similarity_orthogonal_is_zero():
    a = norm(np.array([1.0, 0.0]))
    b = norm(np.array([0.0, 1.0]))
    assert biometric.face_similarity(a, b) == 0.0


def test_liveness_static_photo_fails():
    box = [10, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9]
    detections = [box] * 12  # same box every frame -> zero motion
    passed, motion, message = biometric._liveness_from_frames(12, 640, 480, detections)
    assert passed is False
    assert motion < biometric.LIVENESS_MIN_MOTION


def test_liveness_moving_face_passes():
    boxes = [[10 + i * 6, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9] for i in range(12)]
    passed, motion, message = biometric._liveness_from_frames(12, 640, 480, boxes)
    assert passed is True
    assert motion >= biometric.LIVENESS_MIN_MOTION


def test_liveness_face_missing_most_frames_fails():
    box = [10, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9]
    detections = [box] + [None] * 11  # face in only 1 of 12 frames
    passed, motion, message = biometric._liveness_from_frames(12, 640, 480, detections)
    assert passed is False


def test_url_to_path_resolves_existing_upload():
    name = f"unit_{uuid.uuid4().hex[:8]}.jpg"
    path = Path(biometric.ROOT_DIR) / "uploads" / name
    path.write_bytes(b"x")
    try:
        assert biometric._url_to_path(f"/uploads/{name}") == path
        assert biometric._url_to_path("/uploads/nope_missing.jpg") is None
        assert biometric._url_to_path("https://evil.com/../etc/passwd") is None
    finally:
        path.unlink(missing_ok=True)


# --- Orchestrator ------------------------------------------------------------
def _patch_pipeline(monkeypatch, *, selfie_emb=None, doc_emb=None, liveness_pass=True):
    monkeypatch.setattr(biometric, "ensure_models", lambda: True)
    monkeypatch.setattr(biometric, "_url_to_path", lambda url: Path("/tmp/clip.mp4"))
    selfie_emb = norm(np.ones(128)) if selfie_emb is None else selfie_emb
    doc_emb = selfie_emb if doc_emb is None else doc_emb
    det = [None] * 12
    face_row = np.zeros(15)
    face_row[2], face_row[3] = 200, 200

    def fake_analyze(path):
        motion = 0.12 if liveness_pass else 0.001
        return liveness_pass, motion, 3.0, det

    def fake_best_frame(path, detections):
        import cv2

        ok, buf = cv2.imencode(".jpg", np.zeros((100, 100, 3), np.uint8))
        return buf.tobytes(), face_row

    monkeypatch.setattr(biometric, "_analyze_liveness", fake_analyze)
    monkeypatch.setattr(biometric, "_best_frame_bytes", fake_best_frame)
    monkeypatch.setattr(biometric, "_save_selfie_frame", lambda jpeg, uid: "/uploads/selfie_x.jpg")
    monkeypatch.setattr(biometric, "face_embedding", lambda img, face: selfie_emb)
    monkeypatch.setattr(biometric, "_embed_from_path", lambda path: doc_emb)
    monkeypatch.setattr(biometric, "_first_document_path", lambda profile: Path("/tmp/id.jpg"))
    monkeypatch.setattr(smileid, "_configured", lambda: False)


def test_passes_when_liveness_match_ok_and_kyc_stubbed(monkeypatch):
    _patch_pipeline(monkeypatch)
    status, ref, message, selfie_url = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4")
    )
    assert status == "passed"
    assert selfie_url == "/uploads/selfie_x.jpg"
    assert "liveness:" in ref
    assert "match:" in ref
    assert "kyc:stub" in ref


def test_fails_when_liveness_does_not_pass(monkeypatch):
    _patch_pipeline(monkeypatch, liveness_pass=False)
    status, ref, message, selfie_url = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4")
    )
    assert status == "failed"
    assert ref == "liveness:fail"


def test_fails_when_models_missing(monkeypatch):
    monkeypatch.setattr(biometric, "ensure_models", lambda: False)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4")
    )
    assert status == "failed"
    assert "not set up" in message


def test_fails_when_video_missing(monkeypatch):
    monkeypatch.setattr(biometric, "ensure_models", lambda: True)
    monkeypatch.setattr(biometric, "_url_to_path", lambda url: None)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/nope.mp4")
    )
    assert status == "failed"
    assert "clip" in message


def test_fails_when_face_does_not_match_id(monkeypatch):
    different = norm(np.array([1.0] + [0.0] * 127))
    _patch_pipeline(monkeypatch, doc_emb=different)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4")
    )
    assert status == "failed"
    assert "does not match" in message


def test_fails_when_kyc_rejects(monkeypatch):
    _patch_pipeline(monkeypatch)
    monkeypatch.setattr(smileid, "_configured", lambda: True)

    async def fake_kyc(user, id_type, id_number):
        return "job_kyc"

    async def fake_poll(job_id):
        return ("block", "no")

    monkeypatch.setattr(smileid, "submit_enhanced_kyc", fake_kyc)
    monkeypatch.setattr(smileid, "poll_status", fake_poll)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4")
    )
    assert status == "failed"
    assert "could not be confirmed" in message


def test_kyc_fail_closed_on_provider_error(monkeypatch):
    _patch_pipeline(monkeypatch)
    monkeypatch.setattr(smileid, "_configured", lambda: True)

    async def boom(user, id_type, id_number):
        raise RuntimeError("down")

    monkeypatch.setattr(smileid, "submit_enhanced_kyc", boom)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4")
    )
    assert status == "failed"
    assert "temporarily unavailable" in message


def test_kyc_skipped_for_unsupported_id_type(monkeypatch):
    _patch_pipeline(monkeypatch)
    profile = make_profile(id_type="passport", id_number=None)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(profile, make_user(), "/uploads/clip.mp4")
    )
    assert status == "passed"
    assert "kyc:skip" in ref
    assert "match:" in ref
