"""Driver verification helpers."""
import json
from typing import Optional

from ..models.driver import DriverProfile


def _parse_urls(raw: Optional[str]) -> list:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return [raw]


def verification_out(d: DriverProfile) -> dict:
    return {
        "user_id": d.user_id,
        "verification_status": d.verification_status or "unverified",
        "verification_note": d.verification_note,
        "id_type": d.id_type,
        "id_number": d.id_number,
        "license_number": d.license_number,
        "license_expiry": d.license_expiry,
        "profile_photo": d.profile_photo,
        "document_urls": _parse_urls(d.document_urls),
        "liveness_status": d.liveness_status or "none",
        "liveness_ref": d.liveness_ref,
    }


def admin_verification_out(d: DriverProfile, name: Optional[str], email: str) -> dict:
    out = verification_out(d)
    out["name"] = name
    out["email"] = email
    out["vehicle_type"] = d.vehicle_type
    out["vehicle_plate"] = d.vehicle_plate
    out["submitted_at"] = d.updated_at
    return out


def is_application_complete(d: DriverProfile, required_docs: int) -> bool:
    """True when every required field is present and the selfie passed liveness."""
    docs = _parse_urls(d.document_urls)
    return (
        bool(d.id_type)
        and bool(d.id_number and d.id_number.strip())
        and bool(d.license_number and d.license_number.strip())
        and d.license_expiry is not None
        and bool(d.profile_photo and d.profile_photo.strip())
        and len(docs) >= required_docs
        and d.liveness_status == "passed"
    )
