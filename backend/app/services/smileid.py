"""SmileID V3 client for the Nigerian government ID-number cross-check.

SmileID is a licensed intermediary that can query NIMC/CBN databases directly -
something no in-house code may do. We use ONLY its Enhanced KYC product to
confirm that a driver's NIN/BVN actually exists and matches their name. Face
liveness and face matching are handled in-house by `services.biometric`.

Integration contract (V3, async):
  * POST /v3/token            -> short-lived JWT (15 min), passed as SmileID-Token
  * POST /v3/enhanced_kyc    -> verify an ID number; returns a job_id (async)
  * GET  /v3/status/{jobId}  -> poll to terminal verdict (clear | block | ...)

When SMILEDID_PARTNER_ID / SMILEDID_API_KEY are unset the orchestrator records
``kyc:stub`` and skips the lookup so development stays unblocked.
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
    SMILEDID_API_KEY,
    SMILEDID_ENV,
    SMILEDID_PARTNER_ID,
    SMILEDID_POLL_INTERVAL,
    SMILEDID_POLL_TIMEOUT,
    SMILEDID_TOKEN_TTL_SECONDS,
)
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
    token = await get_token()
    async with httpx.AsyncClient(timeout=httpx.Timeout(60)) as client:
        resp = await client.post(f"{_base_url()}/v3/enhanced_kyc", headers=_auth_headers(token), data=fields)
        resp.raise_for_status()
    body = resp.json()
    job_id = body.get("job_id")
    if not job_id:
        raise RuntimeError(f"SmileID enhanced_kyc did not return a job_id: {body}")
    return job_id


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
