"""Driver verification: self-serve submission + admin review workflow."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import AUTO_VERIFY_DRIVERS, DEV_MODE, VERIFICATION_REQUIRED_DOCS
from ..core.deps import current_user, require_admin
from ..core.realtime import ws_manager
from ..db import get_db
from ..models.driver import DriverProfile
from ..models.user import User
from ..schemas.verification import (
    AdminVerificationOut,
    LivenessOut,
    LivenessSubmitReq,
    VerificationOut,
    VerificationReviewReq,
    VerificationSubmitReq,
)
from ..services.audit import log_audit
from ..services.biometric import run_driver_identity_check
from ..services.notifications import notify
from ..services.verification import admin_verification_out, is_application_complete, verification_out

router = APIRouter(prefix="/api", tags=["verification"])


@router.post("/drivers/verification", response_model=VerificationOut)
async def submit_verification(data: VerificationSubmitReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Register as a driver first")

    profile.id_type = data.id_type
    profile.id_number = data.id_number
    profile.license_number = data.license_number
    profile.license_expiry = data.license_expiry
    profile.profile_photo = data.profile_photo
    profile.document_urls = json.dumps(data.document_urls) if data.document_urls else None
    profile.verification_note = None
    profile.updated_at = datetime.now(timezone.utc)

    if AUTO_VERIFY_DRIVERS and is_application_complete(profile, VERIFICATION_REQUIRED_DOCS):
        profile.verification_status = "verified"
        await log_audit(
            db_sess,
            actor_id=user.user_id,
            action="verification.auto_verified",
            entity_type="driver_profile",
            entity_id=user.user_id,
            meta={"liveness_ref": profile.liveness_ref},
        )
        await notify(
            db_sess,
            user.user_id,
            "Driver verified",
            "Your details and liveness check passed. You can now go online and start earning.",
            category="system",
            data={"verification_status": "verified"},
        )
        await ws_manager.send_to_driver(user.user_id, {"event": "verification.result", "verification_status": "verified"})
    else:
        profile.verification_status = "pending"

    await db_sess.commit()
    return verification_out(profile)


@router.post("/drivers/verification/liveness", response_model=LivenessOut)
async def submit_liveness(
    data: LivenessSubmitReq,
    user: User = Depends(current_user),
    db_sess: AsyncSession = Depends(get_db),
):
    """Run face liveness + face match on a live selfie clip and store the verdict."""
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Register as a driver first")

    status, ref, message, selfie_url = await run_driver_identity_check(profile, user, data.video_url)
    profile.liveness_status = status
    profile.liveness_ref = ref
    if status == "passed" and selfie_url:
        profile.profile_photo = selfie_url
    profile.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return {"status": status, "liveness_status": status, "liveness_ref": ref, "message": message, "selfie_url": selfie_url}


@router.get("/drivers/verification", response_model=VerificationOut)
async def my_verification(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Register as a driver first")
    return verification_out(profile)


@router.get("/admin/drivers/verifications", response_model=list[AdminVerificationOut])
async def admin_list_verifications(
    status: str = "pending",
    admin: User = Depends(require_admin),
    db_sess: AsyncSession = Depends(get_db),
):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.verification_status == status))
    profiles = list(res.scalars().all())
    out = []
    for p in profiles:
        ures = await db_sess.execute(select(User).where(User.user_id == p.user_id))
        u = ures.scalar_one_or_none()
        out.append(admin_verification_out(p, u.name if u else None, u.email if u else ""))
    return out


@router.post("/admin/drivers/{user_id}/verify", response_model=AdminVerificationOut)
async def admin_review_verification(
    user_id: str,
    data: VerificationReviewReq,
    request: Request,
    admin: User = Depends(require_admin),
    db_sess: AsyncSession = Depends(get_db),
):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Driver profile not found")
    if profile.verification_status != "pending":
        raise HTTPException(status_code=400, detail="Only pending verifications can be reviewed")

    profile.verification_status = data.decision
    profile.verification_note = data.note
    profile.updated_at = datetime.now(timezone.utc)
    await log_audit(
        db_sess,
        actor_id=admin.user_id,
        action=f"verification.{data.decision}",
        entity_type="driver_profile",
        entity_id=user_id,
        meta={"note": data.note},
        ip_address=request.client.host if request.client else None,
    )
    if data.decision == "verified":
        title, body = "Driver verified", "Your documents were approved. You can now go online and start earning."
    else:
        title, body = "Verification update", f"Your verification was not approved. {data.note or 'Please resubmit.'}"
    await notify(db_sess, user_id, title, body, category="system", data={"verification_status": data.decision, "note": data.note})
    await db_sess.commit()

    await ws_manager.send_to_driver(user_id, {
        "event": "verification.result",
        "verification_status": data.decision,
        "note": data.note,
    })

    ures = await db_sess.execute(select(User).where(User.user_id == user_id))
    u = ures.scalar_one_or_none()
    return admin_verification_out(profile, u.name if u else None, u.email if u else "")


@router.post("/auth/dev/make-admin")
async def dev_make_admin(data: dict, db_sess: AsyncSession = Depends(get_db)):
    """Dev-only: promote a user to admin (no-op when a real JWT secret is set)."""
    if not DEV_MODE:
        raise HTTPException(status_code=404, detail="Not found")
    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    res = await db_sess.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = 1
    user.role = "admin"
    await db_sess.commit()
    return {"ok": True, "user_id": user.user_id, "is_admin": 1}
