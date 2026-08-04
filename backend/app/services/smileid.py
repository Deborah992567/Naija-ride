"""SmileID V3 client for driver face liveness + ID cross-checks.

SmileID is the freemium provider used here: it runs passive/active liveness on a
live selfie AND matches the selfie to an ID record / document, and it verifies
Nigerian government ID numbers (NIN/BVN/...) against the authoritative source —
exactly the cross-check driver verification needs at scale.

Integration contract (V3, async):
  * POST /v3/token            -> short-lived JWT (15 min), passed as SmileID-Token
  * POST /v3/enhanced_kyc    -> verify an ID number; returns a job_id (async)
  * POST /v3/compare         -> liveness + face match selfie-vs-ID image; job_id
  * GET  /v3/status/{jobId}  -> poll to terminal verdict (clear | block | ...)

When SMILEDID_PARTNER_ID / SMILEDID_API_KEY are unset the module falls back to
an offline dev stub that passes well-formed selfies so the app keeps working.
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

from ..config import (
    PRIVACY_POLICY_URL,
    ROOT_DIR,
    SMILEDID_API_KEY,
    SMILEDID_ENV,
    SMILEDID_PARTNER_ID,
    SMILEDID_POLL_INTERVAL,
    SMILEDID_POLL_TIMEOUT,
    SMILEDID_TOKEN_TTL_SECONDS,
)
from ..models.driver import DriverProfile
from ..models.user import User

logger = logging.getLogger("naija-ride")

BASE_URLS = {
    "sandbox": "https://api.sandbox.smileidentity.com",
    "production": "https://api.smileidentity.com",
}
ID_NUMBER_TYPES = {"nin": "NIN_V2", "national_id": "NIN_SLIP"}

_token_cache: dict = {"token": None, "expires_at": 0.0}


def _configured() -> bool:
    return bool(SMILEDID_PARTNER_ID and SMILEDID_API_KEY)


def _base_url() -> str:
    return BASE_URLS.get(SMILEDID_ENV, BASE_URLS["sandbox"])


def _url_to_path(url: str) -> Optional[str]:
    """Map an uploaded /uploads/<name> URL to its local file path."""
    name = url.split("/uploads/")[-1].split("?")[0]
    if not name or "/" in name:
        return None
    return str(ROOT_DIR / "uploads" / name)


def _split_name(name: Optional[str]) -> tuple[str, str]:
    parts = (name or "").strip().split()
    if not parts:
        return "Driver", "Unknown"
    return " ".join(parts[:-1]) if len(parts) > 1 else parts[0], parts[-1]


def _consent() -> dict:
    return {
        "granted": True,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "notice_language": "EN",
        "notice_privacy_policy_url": PRIVACY_POLICY_URL,
    }


def _user_details(user: User) -> dict:
    given, last = _split_name(user.name)
    return {"given_names": given, "last_name": last, "email": user.email}


async def get_token() -> str:
    """Return a fresh SmileID access token, refreshing the cached one as needed."""
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    headers = {"smileid-partner-id": SMILEDID_PARTNER_ID, "smileid-api-key": SMILEDID_API_KEY}
    async with httpx.AsyncClient(timeout=httpx.Timeout(30)) as client:
        resp = await client.post(f"{_base_url()}/v3/token", headers=headers)
        resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["token"]
    _token_cache["expires_at"] = now + SMILEDID_TOKEN_TTL_SECONDS
    return data["token"]


def _auth_headers(token: str) -> dict:
    return {"SmileID-Partner-ID": SMILEDID_PARTNER_ID, "SmileID-Token": token}


async def _submit_multipart(path: str, fields: dict, files: list) -> str:
    """POST a multipart verification job, returning its job_id."""
    token = await get_token()
    async with httpx.AsyncClient(timeout=httpx.Timeout(60)) as client:
        resp = await client.post(f"{_base_url()}{path}", headers=_auth_headers(token), data=fields, files=files)
        resp.raise_for_status()
    body = resp.json()
    job_id = body.get("job_id")
    if not job_id:
        raise RuntimeError(f"SmileID {path} did not return a job_id: {body}")
    return job_id


async def submit_enhanced_kyc(user: User, id_type: str, id_number: str) -> str:
    """Verify an ID number (NIN/BVN/...) against the government database."""
    fields = {
        "country": "NG",
        "id_type": id_type,
        "id_number": id_number,
        "user_details": json.dumps(_user_details(user)),
        "consent": json.dumps(_consent()),
        "user_id": user.user_id,
        "partner_params": json.dumps({"job_type": "5", "job_id": f"kyc_{uuid.uuid4().hex[:16]}", "user_id": user.user_id}),
    }
    return await _submit_multipart("/v3/enhanced_kyc", fields, [])


async def submit_smart_selfie_compare(user: User, selfie_bytes: bytes, compare_bytes: bytes) -> str:
    """Run liveness + face match comparing a live selfie to an ID image."""
    fields = {
        "comparison_image_type": "DOCUMENT",
        "user_details": json.dumps(_user_details(user)),
        "consent": json.dumps(_consent()),
        "user_id": user.user_id,
        "allow_new_enroll": "true",
        "partner_params": json.dumps({"job_type": "3", "job_id": f"ssc_{uuid.uuid4().hex[:16]}", "user_id": user.user_id}),
    }
    files = [
        ("selfie_image", (f"selfie_{uuid.uuid4().hex[:8]}.jpg", selfie_bytes, "image/jpeg")),
        ("comparison_image", (f"id_{uuid.uuid4().hex[:8]}.jpg", compare_bytes, "image/jpeg")),
    ]
    return await _submit_multipart("/v3/compare", fields, files)


async def poll_status(job_id: str, timeout: int = None) -> tuple[str, str]:
    """Poll a job to a terminal verdict. Returns (status, message).

    Terminal states: clear (passed), block/attention/error (failed). 202 means
    still processing; 404 means the job is unknown to this partner.
    """
    timeout = timeout or SMILEDID_POLL_TIMEOUT
    deadline = time.monotonic() + timeout
    token = await get_token()
    last_status, last_message = "processing", "Still processing"
    while time.monotonic() < deadline:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30)) as client:
            resp = await client.get(f"{_base_url()}/v3/status/{job_id}", headers=_auth_headers(token))
        if resp.status_code == 202:
            last_status, last_message = "processing", "Still processing"
        elif resp.status_code == 200:
            data = resp.json()
            last_status = data.get("status", "error")
            last_message = data.get("message", "")
            if last_status in ("clear", "block", "attention", "error"):
                return last_status, last_message
        elif resp.status_code == 404:
            return "block", "Verification job was not found"
        else:
            resp.raise_for_status()
        await asyncio.sleep(SMILEDID_POLL_INTERVAL)
    return last_status, last_message


async def run_driver_identity_check(
    profile: DriverProfile,
    user: User,
    selfie_url: str,
) -> tuple[str, Optional[str], str]:
    """Run the full identity check for a driver's live selfie.

    Returns (status, ref, message) where status is "passed" or "failed".

    With a configured provider this runs, in order:
      1. Enhanced KYC against the government ID database (when the ID type maps
         to an ID-number product such as NIN) — the authoritative cross-check.
      2. SmartSelfie Compare — liveness on the live selfie plus a face match
         against the driver's uploaded ID image.
    Without provider credentials it falls back to an offline dev stub that
    passes well-formed selfies so development is unblocked.
    """
    if not _configured():
        if not selfie_url or len(selfie_url) > 500:
            return "failed", None, "No valid selfie provided"
        return "passed", f"liveness_{uuid.uuid4().hex[:12]}", "Liveness confirmed (dev stub, no provider configured)"

    if not _validate_selfie(selfie_url):
        return "failed", None, "No valid selfie provided"

    compare_path = _first_document_path(profile)
    if compare_path is None:
        return "failed", None, "Upload your ID document first, then retake the selfie."

    refs = []
    # 1) Cross-check the ID number against the government database.
    smile_type = ID_NUMBER_TYPES.get(profile.id_type or "")
    if smile_type and profile.id_number:
        try:
            kyc_job = await submit_enhanced_kyc(user, smile_type, profile.id_number.strip())
            kyc_status, _ = await poll_status(kyc_job)
            refs.append(f"kyc:{kyc_job}:{kyc_status}")
            if kyc_status != "clear":
                return "failed", "|".join(refs), "ID number could not be confirmed against the national database."
        except Exception as exc:  # noqa: BLE001 - provider outages must not crash onboarding
            logger.warning("smileid enhanced_kyc failed for %s: %s", user.user_id, exc)
            return "failed", None, "Identity check is temporarily unavailable. Try again shortly."

    # 2) Liveness + face match of the live selfie vs the ID image.
    try:
        selfie_bytes = _read_image(selfie_url)
        compare_bytes = _read_image(compare_path)
        if selfie_bytes is None or compare_bytes is None:
            return "failed", None, "Could not read uploaded images."
        compare_job = await submit_smart_selfie_compare(user, selfie_bytes, compare_bytes)
        compare_status, compare_message = await poll_status(compare_job)
        refs.append(f"compare:{compare_job}:{compare_status}")
        if compare_status != "clear":
            return "failed", "|".join(refs), f"Liveness or face match failed: {compare_message or 'no match'}."
    except Exception as exc:  # noqa: BLE001
        logger.warning("smileid compare failed for %s: %s", user.user_id, exc)
        return "failed", "|".join(refs), "Identity check is temporarily unavailable. Try again shortly."

    return "passed", "|".join(refs), "Liveness and ID cross-check passed"


def _validate_selfie(selfie_url: str) -> bool:
    return bool(selfie_url) and isinstance(selfie_url, str) and len(selfie_url) <= 500


def _first_document_path(profile: DriverProfile) -> Optional[str]:
    try:
        urls = json.loads(profile.document_urls) if profile.document_urls else []
    except (ValueError, TypeError):
        urls = [profile.document_urls] if profile.document_urls else []
    for url in urls:
        path = _url_to_path(url)
        if path:
            return path
    return None


def _read_image(url: str) -> Optional[bytes]:
    path = _url_to_path(url)
    if not path:
        return None
    try:
        return open(path, "rb").read()
    except OSError:
        return None
