"""Coupons/promos: validation, discounts for riders, auto bonuses for drivers."""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.coupon import Coupon, CouponRedemption


def coupon_out(c: Coupon) -> dict:
    return {
        "coupon_id": c.coupon_id,
        "code": c.code,
        "description": c.description,
        "discount_type": c.discount_type,
        "discount_value": c.discount_value,
        "audience": c.audience,
        "scope": c.scope,
        "min_trip_fare": c.min_trip_fare,
        "max_discount": c.max_discount,
        "valid_from": c.valid_from,
        "valid_to": c.valid_to,
        "max_uses": c.max_uses,
        "used_count": c.used_count,
        "active": c.active,
    }


def redemption_out(r: CouponRedemption) -> dict:
    return {
        "redemption_id": r.redemption_id,
        "coupon_id": r.coupon_id,
        "user_id": r.user_id,
        "entity_id": r.ride_id,
        "discount": r.discount,
        "created_at": r.created_at,
    }


def discount_for(c: Coupon, fare: float) -> float:
    """Compute the discount amount for a fare, honouring caps and never exceeding fare."""
    if c.discount_type == "percent":
        d = fare * c.discount_value / 100.0
    else:
        d = c.discount_value
    if c.max_discount:
        d = min(d, c.max_discount)
    return round(min(max(d, 0), fare), 2)


def _ensure_window(c: Coupon):
    now = datetime.now(timezone.utc)
    if c.valid_from.replace(tzinfo=timezone.utc) > now:
        raise HTTPException(status_code=400, detail="This promo has not started yet")
    if c.valid_to.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(status_code=400, detail="This promo has expired")


async def _load(db_sess: AsyncSession, code: str) -> Coupon:
    res = await db_sess.execute(select(Coupon).where(Coupon.code == code.strip().upper()))
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return c


async def validate_rider_coupon(db_sess: AsyncSession, code: str, scope: str, fare: float, user_id: str) -> dict:
    """Validate a rider coupon for a service scope and return the discount amount."""
    c = await _load(db_sess, code)
    if not c.active:
        raise HTTPException(status_code=400, detail="This promo is no longer active")
    if c.audience != "rider":
        raise HTTPException(status_code=400, detail="This code is for driver earnings, not rider discounts")
    if c.scope not in (scope, "all"):
        raise HTTPException(status_code=400, detail=f"This promo does not apply to {scope}")
    _ensure_window(c)
    if fare < c.min_trip_fare:
        raise HTTPException(status_code=400, detail=f"This promo requires a minimum fare of ₦{c.min_trip_fare:,.0f}")
    if c.max_uses and c.used_count >= c.max_uses:
        raise HTTPException(status_code=400, detail="This promo has reached its usage limit")
    used_res = await db_sess.execute(
        select(CouponRedemption).where(CouponRedemption.coupon_id == c.coupon_id, CouponRedemption.user_id == user_id)
    )
    if used_res.scalars().first():
        raise HTTPException(status_code=400, detail="You have already used this promo")
    discount = discount_for(c, fare)
    if discount <= 0:
        raise HTTPException(status_code=400, detail="This promo gives no discount on this trip")
    return {"coupon_id": c.coupon_id, "code": c.code, "discount": discount, "fare_after": round(fare - discount, 2)}


async def redeem(db_sess: AsyncSession, coupon_id: str, user_id: str, entity_id: str, discount: float):
    """Record a redemption and bump the usage counter (caller commits)."""
    res = await db_sess.execute(select(Coupon).where(Coupon.coupon_id == coupon_id))
    c = res.scalar_one_or_none()
    if not c:
        return
    c.used_count = (c.used_count or 0) + 1
    db_sess.add(
        CouponRedemption(
            redemption_id=f"cr_{uuid.uuid4().hex[:12]}",
            coupon_id=coupon_id,
            user_id=user_id,
            ride_id=entity_id,
            discount=discount,
        )
    )


async def driver_bonus(db_sess: AsyncSession, scope: str, gross: float, driver_id: str) -> float:
    """Best active driver promo for this service scope → bonus added on top of earnings."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    res = await db_sess.execute(
        select(Coupon).where(
            Coupon.audience == "driver",
            Coupon.active == 1,
            Coupon.valid_from <= now,
            Coupon.valid_to >= now,
        )
    )
    best = 0.0
    best_coupon = None
    for c in res.scalars().all():
        if c.scope not in (scope, "all"):
            continue
        if c.max_uses and c.used_count >= c.max_uses:
            continue
        bonus = c.discount_value if c.discount_type == "fixed" else round(gross * c.discount_value / 100.0, 2)
        if bonus > best:
            best = bonus
            best_coupon = c
    if best_coupon and best > 0:
        await redeem(db_sess, best_coupon.coupon_id, driver_id, f"bonus_{scope}", best)
    return best
