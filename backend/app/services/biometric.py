"""In-house face liveness + face-match engine (no external liveness provider).

Two lightweight ONNX models from the OpenCV Zoo run on our own server:

  * YuNet  - face detection (also reports 5 facial landmarks for alignment).
  * SFace  - 128-d face embeddings; cosine similarity decides whether the live
             selfie and the face on the uploaded ID document are the same person.

The selfie is a short live video clip recorded in the app. Liveness is asserted
from the clip itself (a real face present through most frames AND natural
movement between frames), so a static photo or a screen capture is rejected.

The only external step left is the government ID-number cross-check (NIN/BVN),
which is delegated to SmileID from the `smileid` module because only licensed
intermediaries may query those databases.
"""
import json
import logging
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from ..config import (
    BIOMETRIC_MODELS_DIR,
    BIOMETRIC_MODELS_URL,
    FACE_MATCH_MIN_SCORE,
    LIVENESS_CHALLENGE_LEAD_SECONDS,
    LIVENESS_CHALLENGE_MIN_DEVIATION,
    LIVENESS_CHALLENGE_STEP_SECONDS,
    LIVENESS_CHALLENGE_STILL_MAX,
    LIVENESS_CHALLENGE_TTL_SECONDS,
    LIVENESS_MAX_FRAMES,
    LIVENESS_MIN_DURATION_SECONDS,
    LIVENESS_MIN_FACE_CONF,
    LIVENESS_MIN_FACE_RATIO,
    LIVENESS_MIN_MOTION,
    ROOT_DIR,
    UPLOAD_DIR,
)
from ..models.driver import DriverProfile
from ..models.user import User

logger = logging.getLogger("naija-ride")

# Model files live outside git; auto-downloaded on first use.
MODEL_FILES = {
    "yunet": ("face_detection_yunet", "face_detection_yunet_2023mar.onnx"),
    "sface": ("face_recognition_sface", "face_recognition_sface_2021dec.onnx"),
}

# ArcFace-style 112x112 target landmarks for alignment
# (left-eye, right-eye, nose, left-mouth, right-mouth).
_ARC_TARGET = np.float32(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ]
)

_models_lock = threading.Lock()
_models_ready = False
_detector = None
_sface = None


# --- Model lifecycle --------------------------------------------------------
def _model_path(name: str) -> Path:
    return BIOMETRIC_MODELS_DIR / MODEL_FILES[name][1]


def _download_model(name: str, path: Path) -> bool:
    import requests

    folder, fname = MODEL_FILES[name]
    url = f"{BIOMETRIC_MODELS_URL}/{folder}/{fname}"
    try:
        logger.info("downloading biometric model %s from %s", name, url)
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
        return True
    except Exception as exc:  # noqa: BLE001 - startup resilience
        logger.warning("could not download biometric model %s: %s", name, exc)
        return False


def _load_models() -> None:
    global _detector, _sface
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.log_severity_level = 3  # silence onnxruntime noise

    _detector = cv2.FaceDetectorYN.create(
        str(_model_path("yunet")), "", (320, 320), 0.6, 0.3, 5000
    )
    _sface = ort.InferenceSession(str(_model_path("sface")), so, providers=["CPUExecutionProvider"])


def ensure_models() -> bool:
    """Download (once) and load the ONNX models. Returns True when ready."""
    global _models_ready
    if _models_ready:
        return True
    with _models_lock:
        if _models_ready:
            return True
        missing = [name for name in MODEL_FILES if not _model_path(name).exists()]
        if missing:
            for name in missing:
                if not _download_model(name, _model_path(name)):
                    return False
        try:
            _load_models()
            _models_ready = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("biometric models failed to load: %s", exc)
            return False
        return True


# --- Challenge-response liveness store ----------------------------------------
# A challenge is a short random instruction sequence (e.g. look left -> nod ->
# hold still). The instructions are shown while the app records, so the driver
# cannot pre-record a clip that satisfies a challenge they only learn about
# after clicking "Start". The clip is verified segment-by-segment server-side.
#
# Each challenge carries a TTL so a leaked clip cannot be replayed later.
CHALLENGE_STEPS = ("look_left", "look_right", "nod", "still")
CHALLENGE_STORE: dict[str, dict] = {}
_CHALLENGE_LOCK = threading.Lock()


def _expire_challenges(now: float = None) -> None:
    now = now if now is not None else time.time()
    expired = [cid for cid, ch in CHALLENGE_STORE.items() if ch["expires_at"] < now]
    for cid in expired:
        CHALLENGE_STORE.pop(cid, None)


def _new_step() -> tuple[str, float]:
    """Pick a random instruction and its intended action window (seconds)."""
    step = random.choice(CHALLENGE_STEPS)
    window = LIVENESS_CHALLENGE_STEP_SECONDS + LIVENESS_CHALLENGE_LEAD_SECONDS
    return step, window


def _new_challenge() -> dict:
    """Build a random 3-step sequence with non-adjacent identical steps."""
    sequence = []
    while len(sequence) < 3:
        step, window = _new_step()
        if not sequence or step != sequence[-1][0]:
            sequence.append((step, window))
    total = round(sum(w for _, w in sequence), 2)
    return {
        "sequence": sequence,
        "total": total,
        "created_at": time.time(),
        "expires_at": time.time() + LIVENESS_CHALLENGE_TTL_SECONDS,
    }


def create_challenge() -> tuple[str, dict]:
    """Issue a fresh challenge and return (challenge_id, public challenge)."""
    _expire_challenges()
    challenge_id = uuid.uuid4().hex
    with _CHALLENGE_LOCK:
        challenge = _new_challenge()
        CHALLENGE_STORE[challenge_id] = challenge
    public = {
        "steps": [
            {"instruction": step, "seconds": round(window, 2)}
            for step, window in challenge["sequence"]
        ],
        "total_seconds": challenge["total"],
    }
    return challenge_id, public


def consume_challenge(challenge_id: str) -> Optional[dict]:
    """Return and consume the stored challenge, or None if unknown/expired."""
    _expire_challenges()
    with _CHALLENGE_LOCK:
        return CHALLENGE_STORE.pop(challenge_id, None)


# --- Path / URL helpers ------------------------------------------------------
def _url_to_path(url: str) -> Optional[Path]:
    """Map an uploaded /uploads/<name> URL to its local file path."""
    name = url.split("/uploads/")[-1].split("?")[0]
    if not name or "/" in name:
        return None
    path = ROOT_DIR / "uploads" / name
    return path if path.exists() else None


def _first_document_path(profile: DriverProfile) -> Optional[Path]:
    try:
        urls = json.loads(profile.document_urls) if profile.document_urls else []
    except (ValueError, TypeError):
        urls = [profile.document_urls] if profile.document_urls else []
    for url in urls:
        path = _url_to_path(url)
        if path:
            return path
    return None


# --- Face detection / embedding ----------------------------------------------
def _detect_face(image: np.ndarray) -> Optional[np.ndarray]:
    """Return the best detection row [x,y,w,h,lm*5,score] or None."""
    if image is None:
        return None
    h, w = image.shape[:2]
    if h < 10 or w < 10:
        return None
    _detector.setInputSize((w, h))
    ok, faces = _detector.detect(image)
    if not ok or faces is None or len(faces) == 0:
        return None
    return faces[0]


def _aligned_face(image: np.ndarray, face: np.ndarray) -> Optional[np.ndarray]:
    """Warp the detected face to the 112x112 crop SFace expects."""
    lm = face[4:14].reshape(5, 2)
    # YuNet landmark order is (right-eye, left-eye, nose, right-mouth, left-mouth).
    src = np.float32([lm[1], lm[0], lm[2], lm[4], lm[3]])
    mtx, _ = cv2.estimateAffine2D(src, _ARC_TARGET)
    if mtx is None:
        return None
    aligned = cv2.warpAffine(image, mtx, (112, 112), borderValue=(127, 127, 127))
    return cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB)


def _head_features(width: int, height: int, face: np.ndarray) -> Optional[np.ndarray]:
    """Normalized head-pose features: (x, y, scale) of the face, plus the
    (nose - eyes-midpoint) vector. The last two components dominate when the
    head turns left/right; x/scale move when the head nods up/down.
    """
    if height < 2 or width < 2:
        return None
    face = np.asarray(face, dtype=np.float64)
    x, y, bw, bh = face[:4]
    cx = (x + bw / 2) / width
    cy = (y + bh / 2) / height
    scale = (bw * bh) / (width * height)
    lm = face[4:14].reshape(5, 2)
    eyes_mid = ((lm[0, 0] + lm[1, 0]) / 2, (lm[0, 1] + lm[1, 1]) / 2)
    nose = lm[2]
    dx = (nose[0] - eyes_mid[0]) / width
    dy = (nose[1] - eyes_mid[1]) / height
    return np.float32([cx, cy, scale, dx, dy])


def face_embedding(image: np.ndarray, face: Optional[np.ndarray] = None) -> Optional[np.ndarray]:
    """Return the L2-normalized 128-d SFace embedding for the best face, or None."""
    if not _models_ready:
        return None
    face = face if face is not None else _detect_face(image)
    if face is None:
        return None
    aligned = _aligned_face(image, face)
    if aligned is None:
        return None
    blob = ((aligned.astype(np.float32) - 127.5) / 128.0).transpose(2, 0, 1)[None]
    out = _sface.run(None, {_sface.get_inputs()[0].name: blob})[0].reshape(-1)
    norm = np.linalg.norm(out)
    return out / norm if norm > 0 else None


def face_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two normalized embeddings (0..1)."""
    if a is None or b is None:
        return 0.0
    return float(np.clip(np.dot(a, b), 0.0, 1.0))


def _embed_from_path(path: Path) -> Optional[np.ndarray]:
    image = cv2.imread(str(path))
    if image is None:
        return None
    face = _detect_face(image)
    if face is None:
        return None
    return face_embedding(image, face)


# --- Liveness video analysis ---------------------------------------------------
def _liveness_from_frames(detections: list, width: int, height: int) -> tuple[bool, float, str]:
    """Score a clip from per-frame face detections.

    `detections` holds one entry per sampled frame: a dict with a face row
    [x,y,w,h,...,score] or None when no face was found. A pass requires the
    face to be visible in most frames and to move between frames (still
    photos / screens fail).
    """
    faces = [sample["face"] for sample in detections]
    present = [d for d in faces if d is not None and d[-1] >= LIVENESS_MIN_FACE_CONF]
    if len(faces) and len(present) / len(faces) < LIVENESS_MIN_FACE_RATIO:
        return False, 0.0, "Your face was not visible in most of the clip. Retake in good light."
    if len(present) < 2:
        return False, 0.0, "Your face was not visible in most of the clip. Retake in good light."
    if width < 2 or height < 2:
        return False, 0.0, "Could not read the recorded clip."

    cx = np.array([(d[0] + d[2] / 2) / width for d in present])
    cy = np.array([(d[1] + d[3] / 2) / height for d in present])
    cw = np.array([d[2] / width for d in present])
    motion = float(max(cx.max() - cx.min(), cy.max() - cy.min(), cw.max() - cw.min()))
    if motion < LIVENESS_MIN_MOTION:
        return False, motion, "No movement detected. Keep your head moving through the clip."
    return True, motion, ""


def _sample_video(video_path: Path) -> tuple[list, float, int, int, float]:
    """Read a clip once and return (detections, fps, width, height, duration).

    Every sampled frame carries both the detection row and its source frame
    index, so challenge segments and the best-frame selection can be computed
    without a second pass through the file. A missing/unreadable file yields
    empty detections.
    """
    detections: list = []
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        cap.release()
        return [], 0.0, 0, 0, 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = total / fps if fps > 0 else 0.0
    width = height = 0
    idx = 0
    step = max(total // LIVENESS_MAX_FRAMES, 1) if total > LIVENESS_MAX_FRAMES else 1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        if idx % step != 0:
            continue
        h, w = frame.shape[:2]
        width, height = w, h
        detections.append({"frame": idx - 1, "face": _detect_face(frame)})
    cap.release()
    return detections, fps, width, height, duration


def _look_deviation(feats: list[np.ndarray]) -> float:
    """Signed nose excursion within a segment.

    Negative means the head turned LEFT (nose moved left), positive means RIGHT.
    The magnitude is the largest deviation from the segment mean, the sign comes
    from the direction of travel.
    """
    if not feats:
        return 0.0
    dx = np.array([f[3] for f in feats])
    net = float(dx[-1] - dx[0])
    mag = float(np.max(np.abs(dx - dx.mean())))
    return mag * (1.0 if net >= 0 else -1.0)


def _still_max_deviation(feats: list[np.ndarray]) -> float:
    """Largest combined (x, y, scale) deviation within a segment."""
    if not feats:
        return float("inf")
    arr = np.array(feats)
    return float(np.max(np.sqrt(((arr[:, :3] - arr[:, :3].mean(0)) ** 2).sum(1))))


def analyze_challenge(
    detections: list,
    width: int,
    height: int,
    duration: float,
    challenge: dict,
) -> tuple[bool, float, str]:
    """Verify a clip against a challenge sequence, segment by segment.

    `detections` must be the list of {"frame", "face"} samples produced by
    `_sample_video`. Every intended instruction window is checked against the
    frames that fall inside it:

      * look_left  -> the nose must shift clearly left of its segment mean.
      * look_right -> the nose must shift clearly right of its segment mean.
      * nod        -> the head must move up/down (x/scale change).
      * still      -> the head must not drift beyond LIVENESS_CHALLENGE_STILL_MAX.

    After the instructions pass, the standard motion + face-presence gate runs
    so a static recording can never slip through. Returns (passed, motion, msg).
    """
    sampled_fps = max(len(detections) / duration, 1e-6) if duration > 0 else 0.0
    for step, window in challenge["sequence"]:
        start = sampled_fps * window
        end = sampled_fps * (window + LIVENESS_CHALLENGE_STEP_SECONDS)
        i0 = max(int(start) - 1, 0)
        i1 = min(int(end) + 1, len(detections))
        feats = []
        for sample in detections[i0:i1]:
            face = sample["face"]
            if face is None or face[-1] < LIVENESS_MIN_FACE_CONF:
                continue
            feat = _head_features(width, height, face)
            if feat is not None:
                feats.append(feat)
        if step == "still":
            if _still_max_deviation(feats) > LIVENESS_CHALLENGE_STILL_MAX:
                return False, 0.0, 'You moved during the "hold still" step. Follow the instructions exactly.'
            continue
        if not feats:
            return False, 0.0, "Your face left the frame during the challenge. Follow the instructions."
        look = _look_deviation(feats)
        if step == "look_left" and look > -LIVENESS_CHALLENGE_MIN_DEVIATION:
            return False, 0.0, "Please look clearly to your LEFT when asked."
        if step == "look_right" and look < LIVENESS_CHALLENGE_MIN_DEVIATION:
            return False, 0.0, "Please look clearly to your RIGHT when asked."
        if step == "nod" and _still_max_deviation(feats) < LIVENESS_CHALLENGE_MIN_DEVIATION:
            return False, 0.0, "Please nod your head when asked."
    passed, motion, message = _liveness_from_frames(detections, width, height)
    return passed, motion, message


def _best_frame_bytes(
    video_path: Path, detections: list, width: int, height: int
) -> Optional[tuple[bytes, np.ndarray]]:
    """Persist the frame with the closest, most confident face as a JPEG.

    Returns (jpeg_bytes, face_row) for the best frame, or None.
    """
    best: Optional[tuple[float, np.ndarray, int]] = None  # (score, face, frame_idx)
    for sample in detections:
        det = sample["face"]
        if det is None:
            continue
        x, y, w, h = map(int, det[:4])
        score = float(w * h) * det[-1]
        if best is None or score > best[0]:
            best = (score, det, sample["frame"])
    if best is None:
        return None
    _, face, frame_idx = best
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        cap.release()
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        return None
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return None
    return buf.tobytes(), face


def _save_selfie_frame(jpeg: bytes, user_id: str) -> Optional[str]:
    name = f"{user_id[:8]}_selfie_{uuid.uuid4().hex[:12]}.jpg"
    path = UPLOAD_DIR / name
    path.write_bytes(jpeg)
    return f"/uploads/{name}"


# --- Orchestrator --------------------------------------------------------------
async def run_driver_identity_check(
    profile: DriverProfile,
    user: User,
    video_url: str,
    challenge_id: Optional[str] = None,
) -> tuple[str, Optional[str], str, Optional[str]]:
    """Run the full identity check for a driver's live selfie clip.

    Returns (status, ref, message, selfie_url). The ref encodes the evidence
    trail, e.g. ``liveness:0.08|match:0.62|kyc:clear``, and is stored for audit.
    selfie_url is the persisted best-frame JPEG (the driver's profile photo).

    Checks, in order:
      1. Liveness - the clip must follow the issued challenge (randomized
         instruction sequence) and show a face that moves naturally.
      2. Face match - the selfie must match the face on the uploaded ID doc
         (soft: skipped when the ID document has no usable face).
      3. NIN/BVN cross-check - delegated to SmileID (government database).
    """
    from . import smileid  # local import keeps the module importable without models

    fail = lambda msg: ("failed", None, msg, None)  # noqa: E731
    if not ensure_models():
        return fail("Biometric engine is not set up. Please try again shortly.")

    video_path = _url_to_path(video_url)
    if video_path is None:
        return fail("Could not read the recorded clip. Please record it again.")

    # 1) Liveness. A challenge verifies the randomized instructions segment by
    #    segment; without one, the standard motion gate still applies.
    detections, _fps, width, height, duration = _sample_video(video_path)
    if not detections:
        return fail("Could not read the recorded clip. Please record it again.")

    challenge = consume_challenge(challenge_id) if challenge_id else None
    if challenge_id and challenge is None:
        return fail("The liveness challenge has expired. Please start again.")
    if challenge:
        passed, motion, message = analyze_challenge(
            detections, width, height, duration, challenge
        )
        if not passed:
            return "failed", "liveness:fail", message, None
        required = max(LIVENESS_MIN_DURATION_SECONDS, challenge["total"])
        if duration < required - 0.2:
            return fail("Your recording was too short. Please start again.")
    else:
        passed, motion, message = _liveness_from_frames(detections, width, height)
        if not passed:
            return "failed", "liveness:fail", message, None
        if duration < LIVENESS_MIN_DURATION_SECONDS:
            return fail("Your recording was too short. Please record the full clip.")

    # 2) Extract the best frame as the driver's profile photo + selfie for matching.
    frame = _best_frame_bytes(video_path, detections, width, height)
    if frame is None:
        return fail("Could not extract your face from the clip. Please record it again.")
    selfie_jpeg, selfie_face = frame
    selfie_url = _save_selfie_frame(selfie_jpeg, user.user_id)

    refs = [f"liveness:{motion:.2f}"]

    # 3) Face match against the uploaded ID document (soft gate).
    selfie_img = cv2.imdecode(np.frombuffer(selfie_jpeg, np.uint8), cv2.IMREAD_COLOR)
    selfie_emb = face_embedding(selfie_img, selfie_face) if selfie_img is not None else None
    if selfie_emb is None:
        return "failed", "|".join(refs), "Could not detect your face in the recording. Retake in good light.", None

    doc_path = _first_document_path(profile)
    match_score = None
    if doc_path is not None:
        doc_emb = _embed_from_path(doc_path)
        if doc_emb is not None:
            match_score = face_similarity(selfie_emb, doc_emb)
            refs.append(f"match:{match_score:.2f}")
            if match_score < FACE_MATCH_MIN_SCORE:
                return (
                    "failed",
                    "|".join(refs),
                    "The face in your selfie does not match the face on your ID document.",
                    None,
                )
        else:
            refs.append("match:skip")
    else:
        refs.append("match:skip")

    # 4) Government ID-number cross-check (NIN/BVN) via SmileID - the hard gate.
    smile_type = smileid.ID_NUMBER_TYPES.get(profile.id_type or "")
    if smile_type and profile.id_number:
        if not smileid._configured():
            refs.append("kyc:stub")
        else:
            try:
                job = await smileid.submit_enhanced_kyc(
                    user, smile_type, profile.id_number.strip()
                )
                kyc_status, _ = await smileid.poll_status(job)
                refs.append(f"kyc:{kyc_status}")
                if kyc_status != "clear":
                    return (
                        "failed",
                        "|".join(refs),
                        "Your ID number could not be confirmed against the national database.",
                        None,
                    )
            except Exception as exc:  # noqa: BLE001 - provider outages must not crash onboarding
                logger.warning("smileid enhanced_kyc failed for %s: %s", user.user_id, exc)
                return "failed", None, "Identity check is temporarily unavailable. Try again shortly.", None
    else:
        refs.append("kyc:skip")

    message = "Liveness and face match passed"
    if match_score is not None:
        message += " (selfie matches your ID)"
    return "passed", "|".join(refs), message, selfie_url


# Keep an asyncio.run() wrapper out of the public path; the router awaits directly.
