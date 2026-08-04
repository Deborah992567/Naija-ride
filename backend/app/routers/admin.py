"""Admin management endpoints: stats, users, rides, deliveries, moving, payments."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import require_admin
from ..db import get_db
from ..models.delivery import DeliveryOrder
from ..models.driver import DriverProfile
from ..models.moving import MovingBooking
from ..models.notification import Notification
from ..models.payments import PaymentRecord
from ..models.rides import RideRequest
from ..models.user import User

router = APIRouter(prefix="/api", tags=["admin"])


def _ser(obj) -> dict:
    d = {c: getattr(obj, c) for c in obj.__dict__ if not c.startswith("_")}
    for k, v in d.items():
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


class UserStatusReq(BaseModel):
    status: str  # active | suspended


@router.get("/admin/stats")
async def admin_stats(user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    def count(table, *clauses):
        q = select(func.count()).select_from(table)
        for c in clauses:
            q = q.where(c)
        return q

    counts = {}
    for key, q in {
        "users": count(User),
        "drivers": count(DriverProfile),
        "rides_total": count(RideRequest),
        "rides_active": count(RideRequest, RideRequest.status.in_(["requested", "accepted", "arriving", "in_progress"])),
        "rides_completed": count(RideRequest, RideRequest.status == "completed"),
        "deliveries_active": count(DeliveryOrder, DeliveryOrder.status.in_(["requested", "accepted", "picked_up", "in_transit"])),
        "deliveries_completed": count(DeliveryOrder, DeliveryOrder.status == "delivered"),
        "moving_active": count(MovingBooking, MovingBooking.status.in_(["requested", "accepted", "in_progress"])),
        "moving_completed": count(MovingBooking, MovingBooking.status == "completed"),
        "revenue": count(PaymentRecord, PaymentRecord.status == "success"),
        "payments_pending": count(PaymentRecord, PaymentRecord.status == "pending"),
    }.items():
        res = await db_sess.execute(q)
        counts[key] = res.scalar_one()
    return counts


@router.get("/admin/users")
async def admin_users(
    search: str = "",
    role: str = "",
    user: User = Depends(require_admin),
    db_sess: AsyncSession = Depends(get_db),
):
    q = select(User).order_by(User.created_at.desc()).limit(200)
    if search:
        like = f"%{search}%"
        q = q.where(or_(User.name.ilike(like), User.email.ilike(like), User.phone.ilike(like)))
    if role:
        q = q.where(User.role == role)
    res = await db_sess.execute(q)
    users = list(res.scalars().all())
    out = []
    for u in users:
        d = _ser(u)
        d.pop("password_hash", None)
        out.append(d)
    return out


@router.post("/admin/users/{user_id}/status")
async def admin_set_user_status(user_id: str, data: UserStatusReq, user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    if data.status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db_sess.execute(select(User).where(User.user_id == user_id))
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.user_id == user.user_id:
        raise HTTPException(status_code=400, detail="Cannot suspend yourself")
    target.status = data.status
    db_sess.add(Notification(
        user_id=target.user_id,
        title="Account suspended" if data.status == "suspended" else "Account reactivated",
        body="Your account has been suspended. Contact support." if data.status == "suspended" else "Your account has been reactivated.",
        category="system",
    ))
    await db_sess.commit()
    return {"ok": True, "status": target.status}


@router.get("/admin/rides")
async def admin_rides(status: str = "", user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    q = select(RideRequest).order_by(RideRequest.created_at.desc()).limit(200)
    if status:
        q = q.where(RideRequest.status == status)
    res = await db_sess.execute(q)
    rides = list(res.scalars().all())
    out = []
    for r in rides:
        d = _ser(r)
        for label, uid in (("rider", r.rider_id), ("driver", r.driver_id)):
            if uid:
                ures = await db_sess.execute(select(User.name).where(User.user_id == uid))
                d[f"{label}_name"] = ures.scalar_one_or_none() or uid
        out.append(d)
    return out


@router.get("/admin/deliveries")
async def admin_deliveries(status: str = "", user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    q = select(DeliveryOrder).order_by(DeliveryOrder.created_at.desc()).limit(200)
    if status:
        q = q.where(DeliveryOrder.status == status)
    res = await db_sess.execute(q)
    rows = list(res.scalars().all())
    out = []
    for r in rows:
        d = _ser(r)
        for label, uid in (("customer", r.requester_id), ("driver", r.driver_id)):
            if uid:
                ures = await db_sess.execute(select(User.name).where(User.user_id == uid))
                d[f"{label}_name"] = ures.scalar_one_or_none() or uid
        out.append(d)
    return out


@router.get("/admin/moving")
async def admin_moving(status: str = "", user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    q = select(MovingBooking).order_by(MovingBooking.created_at.desc()).limit(200)
    if status:
        q = q.where(MovingBooking.status == status)
    res = await db_sess.execute(q)
    rows = list(res.scalars().all())
    out = []
    for r in rows:
        d = _ser(r)
        for label, uid in (("customer", r.customer_id), ("driver", r.driver_id)):
            if uid:
                ures = await db_sess.execute(select(User.name).where(User.user_id == uid))
                d[f"{label}_name"] = ures.scalar_one_or_none() or uid
        out.append(d)
    return out


@router.get("/admin/payments")
async def admin_payments(status: str = "", user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    q = select(PaymentRecord).order_by(PaymentRecord.created_at.desc()).limit(200)
    if status:
        q = q.where(PaymentRecord.status == status)
    res = await db_sess.execute(q)
    return [_ser(r) for r in res.scalars().all()]
