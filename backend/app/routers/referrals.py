"""Referral program endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..core.logging import log_event
from ..db import get_db
from ..models.user import User
from ..schemas.referrals import ReferralApplyOut, ReferralApplyReq, ReferralOut
from ..services.referrals import apply_referral, referrals_out

router = APIRouter(prefix="/api", tags=["referrals"])


@router.get("/referrals", response_model=ReferralOut)
async def my_referrals(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    out = await referrals_out(db_sess, user)
    await db_sess.commit()
    return out


@router.post("/referrals/apply", response_model=ReferralApplyOut)
async def apply(data: ReferralApplyReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    out = await apply_referral(db_sess, user, data.code)
    await db_sess.commit()
    log_event("referrals", "referral.applied", user_id=user.user_id, code=data.code, **{k: out.get(k) for k in ("reward", "message") if k in out})
    return ReferralApplyOut(**out)
