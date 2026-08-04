"""Coupons/promos: admin management + rider validation."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user, require_admin
from ..db import get_db
from ..models.coupon import Coupon, CouponRedemption
from ..models.user import User
from ..schemas.coupons import CouponCreateReq, CouponOut, CouponValidateOut, CouponValidateReq
from ..services.coupons import coupon_out, redemption_out, validate_rider_coupon

router = APIRouter(prefix="/api", tags=["coupons"])


@router.get("/admin/coupons", response_model=list[CouponOut])
async def admin_list_coupons(admin: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Coupon).order_by(Coupon.created_at.desc()))
    return [coupon_out(c) for c in res.scalars().all()]


@router.post("/admin/coupons", response_model=CouponOut)
async def admin_create_coupon(data: CouponCreateReq, admin: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    if data.discount_value <= 0:
        raise HTTPException(status_code=400, detail="Discount value must be positive")
    if data.discount_type == "percent" and data.discount_value > 100:
        raise HTTPException(status_code=400, detail="Percent discount cannot exceed 100")
    if data.valid_to <= data.valid_from:
        raise HTTPException(status_code=400, detail="valid_to must be after valid_from")
    code = data.code.strip().upper()
    res = await db_sess.execute(select(Coupon).where(Coupon.code == code))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A coupon with this code already exists")
    coupon = Coupon(
        coupon_id=f"cp_{uuid.uuid4().hex[:12]}",
        code=code,
        description=data.description,
        discount_type=data.discount_type,
        discount_value=data.discount_value,
        audience=data.audience,
        scope=data.scope,
        min_trip_fare=data.min_trip_fare,
        max_discount=data.max_discount,
        valid_from=data.valid_from.replace(tzinfo=None),
        valid_to=data.valid_to.replace(tzinfo=None),
        max_uses=data.max_uses,
        used_count=0,
        active=1,
    )
    db_sess.add(coupon)
    await db_sess.commit()
    return coupon_out(coupon)


@router.post("/admin/coupons/{coupon_id}/toggle", response_model=CouponOut)
async def admin_toggle_coupon(coupon_id: str, admin: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Coupon).where(Coupon.coupon_id == coupon_id))
    coupon = res.scalar_one_or_none()
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    coupon.active = 0 if coupon.active else 1
    await db_sess.commit()
    return coupon_out(coupon)


@router.get("/admin/coupons/{coupon_id}/redemptions")
async def admin_coupon_redemptions(coupon_id: str, admin: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(CouponRedemption).where(CouponRedemption.coupon_id == coupon_id).order_by(CouponRedemption.created_at.desc())
    )
    return [redemption_out(r) for r in res.scalars().all()]


@router.post("/coupons/validate", response_model=CouponValidateOut)
async def validate_coupon(data: CouponValidateReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    out = await validate_rider_coupon(db_sess, data.code, data.scope, data.fare, user.user_id)
    return CouponValidateOut(**out)


@router.get("/coupons/my")
async def my_redemptions(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(CouponRedemption).where(CouponRedemption.user_id == user.user_id).order_by(CouponRedemption.created_at.desc())
    )
    return [redemption_out(r) for r in res.scalars().all()]
