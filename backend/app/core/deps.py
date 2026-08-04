"""Authentication/authorization FastAPI dependencies."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.user import User, UserSession
from .security import decode_token


async def current_user(request: Request, db_sess: AsyncSession = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()

    user_id = decode_token(token)
    if user_id:
        res = await db_sess.execute(select(User).where(User.user_id == user_id))
        user = res.scalar_one_or_none()
        if user:
            if (user.status or "active") == "suspended":
                raise HTTPException(status_code=403, detail="Your account has been suspended")
            return user

    # Fall back to opaque google session tokens
    res = await db_sess.execute(select(UserSession).where(UserSession.session_token == token))
    sess = res.scalar_one_or_none()
    if sess:
        if sess.expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc):
            res = await db_sess.execute(select(User).where(User.user_id == sess.user_id))
            user = res.scalar_one_or_none()
            if user:
                if (user.status or "active") == "suspended":
                    raise HTTPException(status_code=403, detail="Your account has been suspended")
                return user

    raise HTTPException(status_code=401, detail="Invalid or expired token")


async def optional_user(request: Request, db_sess: AsyncSession = Depends(get_db)) -> Optional[User]:
    try:
        return await current_user(request, db_sess)
    except HTTPException:
        return None


async def require_admin(request: Request, db_sess: AsyncSession = Depends(get_db)) -> User:
    user = await current_user(request, db_sess)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
