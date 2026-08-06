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


def dets_from_boxes(boxes):
    return [{"frame": i, "face": b} for i, b in enumerate(boxes)]


def test_liveness_static_photo_fails():
    box = [10, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9]
    detections = dets_from_boxes([box] * 12)  # same box every frame -> zero motion
    passed, motion, message = biometric._liveness_from_frames(detections, 640, 480)
    assert passed is False
    assert motion < biometric.LIVENESS_MIN_MOTION


def test_liveness_moving_face_passes():
    boxes = [[10 + i * 6, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9] for i in range(12)]
    passed, motion, message = biometric._liveness_from_frames(dets_from_boxes(boxes), 640, 480)
    assert passed is True
    assert motion >= biometric.LIVENESS_MIN_MOTION


def test_liveness_face_missing_most_frames_fails():
    box = [10, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9]
    detections = dets_from_boxes([box] + [None] * 11)  # face in only 1 of 12 frames
    passed, motion, message = biometric._liveness_from_frames(detections, 640, 480)
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
    face_row = np.zeros(15)
    face_row[2], face_row[3] = 200, 200

    def fake_sample(path):
        if liveness_pass:
            boxes = [[10 + i * 6, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9] for i in range(12)]
        else:
            boxes = [[10, 10, 200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9]] * 12
        return dets_from_boxes(boxes), 30.0, 640, 480, 7.0

    def fake_best_frame(path, detections, width, height):
        import cv2

        ok, buf = cv2.imencode(".jpg", np.zeros((100, 100, 3), np.uint8))
        return buf.tobytes(), face_row

    monkeypatch.setattr(biometric, "_sample_video", fake_sample)
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


# --- Challenge-response liveness ----------------------------------------------
def face_row(nose_shift=0, x=90, y=80, w=200, h=260, score=0.9):
    """YuNet-style detection row with landmarks; the nose can be offset left/right."""
    ex, ey = 210, y + h * 0.4
    nose_x, nose_y = ex + nose_shift, y + h * 0.55
    mouth_y = y + h * 0.7
    lm = [ex - 30, ey, ex + 30, ey, nose_x, nose_y, nose_x - 15, mouth_y, nose_x + 15, mouth_y]
    return [x, y, w, h] + lm + [score]


def challenge_of(*steps):
    """Build the internal challenge dict with the configured per-step window."""
    return {
        "sequence": [(s, biometric.LIVENESS_CHALLENGE_STEP_SECONDS + biometric.LIVENESS_CHALLENGE_LEAD_SECONDS) for s in steps],
        "total": len(steps) * (biometric.LIVENESS_CHALLENGE_STEP_SECONDS + biometric.LIVENESS_CHALLENGE_LEAD_SECONDS),
    }


def test_create_challenge_sequence_and_consume():
    cid, public = biometric.create_challenge()
    assert len(public["steps"]) == 3
    for i, step in enumerate(public["steps"][1:], start=1):
        assert step["instruction"] != public["steps"][i - 1]["instruction"]
    assert public["total_seconds"] == pytest.approx(
        biometric.LIVENESS_CHALLENGE_STEP_SECONDS * 3 + biometric.LIVENESS_CHALLENGE_LEAD_SECONDS * 3
    )
    assert biometric.consume_challenge(cid) is not None
    assert biometric.consume_challenge(cid) is None


def test_consume_expired_challenge_returns_none():
    cid, _ = biometric.create_challenge()
    biometric.CHALLENGE_STORE[cid]["expires_at"] = 0
    assert biometric.consume_challenge(cid) is None


def test_analyze_challenge_look_left_then_still_passes():
    shifts = [0] * 30
    for i, s in ((1, 20), (2, -40), (3, -100)):  # sweep to the LEFT in the first window
        shifts[i] = s
    for i in range(3, 7):  # hold still during the second window
        shifts[i] = -100
    dets = dets_from_boxes([face_row(nose_shift=s, x=90 + i * 2) for i, s in enumerate(shifts)])
    passed, motion, message = biometric.analyze_challenge(dets, 640, 480, 30.0, challenge_of("look_left", "still"))
    assert passed is True
    assert motion >= biometric.LIVENESS_MIN_MOTION


def test_analyze_challenge_wrong_direction_fails():
    shifts = [0] * 30
    for i, s in ((1, 20), (2, -40), (3, -100)):  # looked LEFT although told RIGHT
        shifts[i] = s
    dets = dets_from_boxes([face_row(nose_shift=s, x=90 + i * 2) for i, s in enumerate(shifts)])
    passed, motion, message = biometric.analyze_challenge(dets, 640, 480, 30.0, challenge_of("look_right"))
    assert passed is False
    assert "RIGHT" in message


def test_analyze_challenge_hold_still_rejects_motion():
    rows = [
        face_row(nose_shift=0, x=90 + i * 2, y=220 if 3 <= i <= 6 else 80)
        for i in range(30)
    ]
    passed, motion, message = biometric.analyze_challenge(dets_from_boxes(rows), 640, 480, 30.0, challenge_of("still"))
    assert passed is False
    assert "hold still" in message


def test_analyze_challenge_nod_passes():
    rows = []
    for i in range(30):
        if 1 <= i <= 3:  # nod: face drops down during the window
            y = [80, 130, 165][i - 1]
        else:
            y = 80
        rows.append(face_row(nose_shift=0, x=90 + i * 2, y=y))
    passed, motion, message = biometric.analyze_challenge(dets_from_boxes(rows), 640, 480, 30.0, challenge_of("nod"))
    assert passed is True
    assert motion >= biometric.LIVENESS_MIN_MOTION


def test_analyze_challenge_face_leaves_frame_fails():
    shifts = [0] * 30
    for i, s in ((1, 20), (2, -40), (3, -100)):
        shifts[i] = s
    rows = [face_row(nose_shift=s, x=90 + i * 2) if i not in (1, 2, 3) else None for i, s in enumerate(shifts)]
    passed, motion, message = biometric.analyze_challenge(dets_from_boxes(rows), 640, 480, 30.0, challenge_of("look_left"))
    assert passed is False
    assert "left the frame" in message


def test_orchestrator_consumes_challenge_and_passes(monkeypatch):
    _patch_pipeline(monkeypatch)
    monkeypatch.setattr(biometric, "analyze_challenge", lambda dets, w, h, dur, ch: (True, 0.12, ""))
    cid, _ = biometric.create_challenge()
    status, ref, message, selfie_url = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4", cid)
    )
    assert status == "passed"
    assert "liveness:0.12" in ref
    assert biometric.consume_challenge(cid) is None


def test_orchestrator_rejects_expired_challenge(monkeypatch):
    _patch_pipeline(monkeypatch)
    status, ref, message, _ = asyncio.run(
        biometric.run_driver_identity_check(make_profile(), make_user(), "/uploads/clip.mp4", "missing_challenge")
    )
    assert status == "failed"
    assert "expired" in message
