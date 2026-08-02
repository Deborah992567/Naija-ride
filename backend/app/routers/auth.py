"""Authentication + account endpoints."""
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..core.logging import log_event
from ..core.security import hash_pw, issue_token, validate_password, verify_pw
from ..db import get_db
from ..models.chat import Message
from ..models.coupon import CouponRedemption
from ..models.driver import DriverProfile
from ..models.notification import Notification
from ..models.safety import EmergencyContact, EmergencyRecord, TripShare
from ..models.ticket import SupportMessage, SupportTicket
from ..models.user import DeviceToken, PasswordReset, User, UserSession
from ..models.wallet import Wallet, WalletTransaction, WithdrawalRequest
from ..schemas.auth import (
    AuthResponse,
    DeleteAccountReq,
    ForgotOut,
    ForgotReq,
    GoogleSessionReq,
    LoginReq,
    PushTokenReq,
    RegisterReq,
    ResetReq,
    UserOut,
    user_to_out,
)
from ..services.referrals import apply_referral, generate_referral_code

logger = logging.getLogger("naija-ride")
router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/register", response_model=AuthResponse)
async def register(data: RegisterReq, db_sess: AsyncSession = Depends(get_db)):
    pw_error = validate_password(data.password)
    if pw_error:
        raise HTTPException(status_code=400, detail=pw_error)
    email = data.email.lower()
    res = await db_sess.execute(select(User).where(User.email == email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    now = datetime.now(timezone.utc)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_pw(data.password),
        "name": data.name or email.split("@")[0],
        "picture": None,
        "karma": 0,
        "provider": "password",
        "role": "user",
        "state": data.state,
        "is_admin": 0,
        "referral_code": await generate_referral_code(db_sess),
        "created_at": now,
        "updated_at": now,
    }
    new_user = User(**user_doc)
    db_sess.add(new_user)
    if data.referral_code:
        await apply_referral(db_sess, new_user, data.referral_code)
    await db_sess.commit()
    token = issue_token(user_id)
    log_event("auth", "user.signup", user_id=user_id, email=email, provider="password", referral=data.referral_code)
    return AuthResponse(token=token, user=user_to_out(user_doc))


@router.post("/auth/login", response_model=AuthResponse)
async def login(data: LoginReq, db_sess: AsyncSession = Depends(get_db)):
    email = data.email.lower()
    res = await db_sess.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user or not user.password_hash or not verify_pw(data.password, user.password_hash):
        log_event("auth", "user.login_failed", email=email, reason="invalid_credentials")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if (user.status or "active") == "suspended":
        log_event("auth", "user.login_blocked", user_id=user.user_id, email=email, reason="suspended")
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact support.")
    token = issue_token(user.user_id)
    log_event("auth", "user.login", user_id=user.user_id, email=email, provider="password")
    return AuthResponse(token=token, user=user_to_out(user.__dict__))


@router.post("/auth/google-session", response_model=AuthResponse)
async def google_session(data: GoogleSessionReq, db_sess: AsyncSession = Depends(get_db)):
    """Exchange Emergent session_id (from OAuth redirect) for app token & user."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": data.session_id},
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}") from e
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    payload = r.json()
    email = payload["email"].lower()
    name = payload.get("name")
    picture = payload.get("picture")
    session_token = payload["session_token"]

    now = datetime.now(timezone.utc)
    res = await db_sess.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    is_new = user is None
    if is_new:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = User(
            user_id=user_id, email=email, name=name, picture=picture,
            karma=0, provider="google", referral_code=await generate_referral_code(db_sess),
            created_at=now, updated_at=now
        )
        db_sess.add(user)
    else:
        user.name = name or user.name
        user.picture = picture or user.picture
        user.updated_at = now

    await db_sess.execute(delete(UserSession).where(UserSession.session_token == session_token))
    new_sess = UserSession(
        session_token=session_token, user_id=user.user_id,
        expires_at=now + timedelta(days=7), created_at=now
    )
    db_sess.add(new_sess)
    await db_sess.commit()

    token = issue_token(user.user_id)
    log_event("auth", "user.google_login", user_id=user.user_id, email=email, is_new=is_new)
    return AuthResponse(token=token, user=user_to_out(user.__dict__))


@router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user_to_out(user.__dict__)


@router.post("/auth/logout")
async def logout(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    await db_sess.execute(delete(UserSession).where(UserSession.user_id == user.user_id))
    await db_sess.commit()
    log_event("auth", "user.logout", user_id=user.user_id, email=user.email)
    return {"ok": True}


@router.delete("/auth/account", response_model=dict)
async def delete_account(data: DeleteAccountReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    """Permanently delete the signed-in account and all of its data."""
    if user.password_hash:
        if not data.password or not verify_pw(data.password, user.password_hash):
            raise HTTPException(status_code=400, detail="Enter your password to confirm account deletion")
    if user.is_admin:
        raise HTTPException(status_code=403, detail="Admins cannot delete their account from the app")

    uid = user.user_id
    email = user.email
    await db_sess.execute(delete(UserSession).where(UserSession.user_id == uid))
    await db_sess.execute(delete(DeviceToken).where(DeviceToken.user_id == uid))
    await db_sess.execute(delete(PasswordReset).where(PasswordReset.user_id == uid))
    await db_sess.execute(delete(DriverProfile).where(DriverProfile.user_id == uid))
    await db_sess.execute(delete(Notification).where(Notification.user_id == uid))
    await db_sess.execute(delete(SupportTicket).where(SupportTicket.user_id == uid))
    await db_sess.execute(delete(SupportMessage).where(SupportMessage.user_id == uid))
    await db_sess.execute(delete(Wallet).where(Wallet.user_id == uid))
    await db_sess.execute(delete(WalletTransaction).where(WalletTransaction.user_id == uid))
    await db_sess.execute(delete(WithdrawalRequest).where(WithdrawalRequest.user_id == uid))
    await db_sess.execute(delete(CouponRedemption).where(CouponRedemption.user_id == uid))
    await db_sess.execute(delete(EmergencyRecord).where(EmergencyRecord.user_id == uid))
    await db_sess.execute(delete(EmergencyContact).where(EmergencyContact.user_id == uid))
    await db_sess.execute(delete(TripShare).where(TripShare.user_id == uid))
    await db_sess.execute(delete(Message).where((Message.sender_id == uid) | (Message.recipient_id == uid)))
    # Detach the deleted user from anyone they referred so those chains stay valid.
    await db_sess.execute(User.__table__.update().where(User.referred_by == uid).values(referred_by=None))
    await db_sess.delete(user)
    await db_sess.commit()
    log_event("auth", "user.account_deleted", user_id=uid, email=email)
    logger.info("Account deleted: %s (%s)", email, uid)
    return {"ok": True, "message": "Account permanently deleted."}


@router.post("/auth/forgot", response_model=ForgotOut)
async def forgot(data: ForgotReq, db_sess: AsyncSession = Depends(get_db)):
    """Generate a password-reset token. In production, email the token to the
    user; in this dev build the token is returned so the flow is testable."""
    res = await db_sess.execute(select(User).where(User.email == data.email.lower()))
    user = res.scalar_one_or_none()
    if not user:
        return ForgotOut(ok=True, message="If that email exists, a reset link has been sent.")
    if user.provider == "google":
        return ForgotOut(ok=True, message="This account uses Google sign-in — use 'Continue with Google'.")

    token = f"rst_{uuid.uuid4().hex[:32]}"
    now = datetime.now(timezone.utc)
    await db_sess.execute(delete(PasswordReset).where(PasswordReset.user_id == user.user_id))
    db_sess.add(PasswordReset(
        token=token, user_id=user.user_id,
        expires_at=now + timedelta(hours=1), created_at=now
    ))
    await db_sess.commit()
    log_event("auth", "user.password_reset_requested", user_id=user.user_id, email=user.email)
    logger.info("Password reset requested for %s (token %s)", user.email, token)
    return ForgotOut(
        ok=True,
        message="A reset link has been sent to your email.",
        reset_token=token,
    )


@router.post("/auth/reset")
async def reset(data: ResetReq, db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(PasswordReset).where(PasswordReset.token == data.token))
    record = res.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not record or record.used:
        raise HTTPException(status_code=400, detail="Invalid or already-used reset token")
    pw_error = validate_password(data.password)
    if pw_error:
        raise HTTPException(status_code=400, detail=pw_error)
    expires = record.expires_at.replace(tzinfo=timezone.utc) if record.expires_at.tzinfo is None else record.expires_at
    if expires < now:
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user_res = await db_sess.execute(select(User).where(User.user_id == record.user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Account no longer exists")

    user.password_hash = hash_pw(data.password)
    user.updated_at = now
    record.used = 1
    await db_sess.execute(delete(UserSession).where(UserSession.user_id == user.user_id))
    await db_sess.commit()
    log_event("auth", "user.password_reset", user_id=user.user_id)
    return {"ok": True, "message": "Password updated. Sign in with your new password."}


@router.post("/me/push-token")
async def register_push_token(data: PushTokenReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    existing = await db_sess.execute(select(DeviceToken).where(DeviceToken.user_id == user.user_id))
    record = existing.scalar_one_or_none()
    if record:
        record.push_token = data.push_token
        record.updated_at = datetime.now(timezone.utc)
    else:
        db_sess.add(DeviceToken(user_id=user.user_id, push_token=data.push_token, updated_at=datetime.now(timezone.utc)))
    await db_sess.commit()
    return {"ok": True}
