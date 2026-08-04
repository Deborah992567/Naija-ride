"""In-app notification endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..db import get_db
from ..models.notification import Notification
from ..models.user import User
from ..schemas.safety import NotificationOut, UnreadCountOut
from ..services.notifications import notification_out

router = APIRouter(prefix="/api", tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(limit: int = 30, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    limit = max(1, min(limit, 100))
    res = await db_sess.execute(
        select(Notification)
        .where(Notification.user_id == user.user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return [notification_out(n) for n in res.scalars().all()]


@router.get("/notifications/unread-count", response_model=UnreadCountOut)
async def unread_count(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(func.count(Notification.notification_id)).where(
            Notification.user_id == user.user_id,
            Notification.read_at.is_(None),
        )
    )
    return UnreadCountOut(count=res.scalar_one())


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Notification).where(Notification.notification_id == notification_id))
    n = res.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your notification")
    if n.read_at is None:
        from datetime import datetime, timezone

        n.read_at = datetime.now(timezone.utc)
        await db_sess.commit()
    return notification_out(n)


@router.post("/notifications/read-all")
async def mark_all_read(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    from datetime import datetime, timezone

    res = await db_sess.execute(
        select(Notification).where(Notification.user_id == user.user_id, Notification.read_at.is_(None))
    )
    unread = res.scalars().all()
    for n in unread:
        n.read_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return {"ok": True, "marked": len(unread)}
