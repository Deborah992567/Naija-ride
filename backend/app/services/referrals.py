"""Referral program: invite codes, applying a code, and reward payouts.

Every user gets a unique uppercase invite code at signup. When someone signs up
with that code (or applies it later), both the referrer and the new user receive
wallet credits. Credits + tracking compose with the caller's transaction — the
caller commits.
"""
import random
import string
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import REFERRAL_REFERRED_REWARD, REFERRAL_REFERRER_REWARD, SHARE_BASE_URL
from ..models.user import User
from ..services.audit import log_audit
from ..services.notifications import notify
from ..services.wallet import credit, wallet_transactions

CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LENGTH = 8


def _generate_code() -> str:
    return "".join(random.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


async def generate_referral_code(db_sess: AsyncSession) -> str:
    """A unique referral code, retrying on the (astronomically rare) collision."""
    for _ in range(10):
        candidate = _generate_code()
        res = await db_sess.execute(select(User.user_id).where(User.referral_code == candidate).limit(1))
        if res.first() is None:
            return candidate
    return f"NR{random.randint(100000, 999999)}"


async def assign_referral_code(db_sess: AsyncSession, user: User) -> str:
    """Ensure a user has a referral code (lazily assigned for legacy rows)."""
    if not user.referral_code:
        user.referral_code = await generate_referral_code(db_sess)
    return user.referral_code


async def apply_referral(db_sess: AsyncSession, user: User, raw_code: str) -> dict:
    """Attach a referrer to `user` and pay out both rewards.

    Composes with the caller's transaction — call `await db_sess.commit()`
    afterwards. Returns the reward summary.
    """
    code = raw_code.strip().upper()
    if user.referred_by:
        raise HTTPException(status_code=400, detail="You have already joined with a referral code")
    if user.referral_code and user.referral_code == code:
        raise HTTPException(status_code=400, detail="You cannot use your own referral code")

    res = await db_sess.execute(select(User).where(User.referral_code == code).limit(1))
    referrer = res.scalars().first()
    if not referrer:
        raise HTTPException(status_code=404, detail="Referral code not found")
    if referrer.user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You cannot use your own referral code")

    user.referred_by = referrer.user_id
    user.updated_at = datetime.now(timezone.utc)

    await credit(
        db_sess, referrer.user_id, REFERRAL_REFERRER_REWARD,
        category="referral", reference=f"ref_{user.user_id}",
        meta={"referred_user_id": user.user_id, "code": code, "type": "referrer"},
    )
    await credit(
        db_sess, user.user_id, REFERRAL_REFERRED_REWARD,
        category="referral", reference=f"ref_{user.user_id}",
        meta={"referrer_user_id": referrer.user_id, "code": code, "type": "referred"},
    )
    await notify(
        db_sess, referrer.user_id, "Referral bonus",
        f"{user.name or user.email} joined with your code — ₦{REFERRAL_REFERRER_REWARD:,.0f} added to your wallet.",
        category="referral", data={"code": code, "referred_user_id": user.user_id, "reward": REFERRAL_REFERRER_REWARD},
    )
    await notify(
        db_sess, user.user_id, "Welcome bonus",
        f"₦{REFERRAL_REFERRED_REWARD:,.0f} added to your wallet for joining Naija Ride.",
        category="referral", data={"code": code, "referrer_user_id": referrer.user_id, "reward": REFERRAL_REFERRED_REWARD},
    )
    await log_audit(
        db_sess, referrer.user_id, "referral.applied", "user", user.user_id,
        {"code": code, "referred_user_id": user.user_id},
    )
    return {"referrer_user_id": referrer.user_id, "referrer_reward": REFERRAL_REFERRER_REWARD, "reward": REFERRAL_REFERRED_REWARD}


async def referrals_out(db_sess: AsyncSession, user: User) -> dict:
    """Summary for GET /api/referrals: my code, who joined with it, total earned."""
    await assign_referral_code(db_sess, user)

    res = await db_sess.execute(select(User).where(User.referred_by == user.user_id).order_by(User.created_at.desc()))
    referrals = []
    for ref in res.scalars().all():
        referrals.append({
            "user_id": ref.user_id,
            "name": ref.name,
            "email": ref.email,
            "created_at": ref.created_at,
        })

    txns = await wallet_transactions(db_sess, user.user_id, limit=200)
    total_rewards = round(sum(t.amount for t in txns if t.category == "referral" and t.txn_type == "credit"), 2)

    return {
        "referral_code": user.referral_code,
        "referral_link": f"{SHARE_BASE_URL}/r/{user.referral_code}",
        "referrer_reward": REFERRAL_REFERRER_REWARD,
        "referred_reward": REFERRAL_REFERRED_REWARD,
        "referrals": referrals,
        "total_rewards": total_rewards,
    }
