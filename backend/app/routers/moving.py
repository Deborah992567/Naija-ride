"""House/office moving service: quote, booking, WS dispatch, lifecycle."""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..core.geo import distance_minutes, road_distance_km
from ..core.logging import log_event
from ..core.realtime import ws_manager
from ..db import get_db
from ..models.driver import DriverProfile
from ..models.moving import MovingBooking
from ..models.user import User
from ..schemas.moving import (
    MovingCreateReq,
    MovingOut,
    MovingPaymentReq,
    MovingQuoteOut,
    MovingQuoteReq,
)
from ..services.moving import load_moving, moving_out, quote_moving_fee
from ..services.coupons import driver_bonus, redeem, validate_rider_coupon
from ..services.notifications import notify
from ..services.wallet import credit, debit, driver_share

router = APIRouter(prefix="/api", tags=["moving"])


@router.post("/moving/quote", response_model=MovingQuoteOut)
async def moving_quote(data: MovingQuoteReq, db_sess: AsyncSession = Depends(get_db)):
    distance = road_distance_km(data.origin_lat, data.origin_lng, data.destination_lat, data.destination_lng)
    fee = await quote_moving_fee(db_sess, distance, data.truck_size)
    # Moves are slower than rides: loading/unloading adds time.
    eta = max(45, distance_minutes(distance) * 2)
    log_event("moving", "moving.quote", distance_km=round(distance, 1), fee=fee, truck_size=data.truck_size)
    return MovingQuoteOut(
        distance_km=round(distance, 1),
        fee=fee,
        eta_minutes=eta,
        allowed=True,
        reason=None,
    )


@router.post("/moving", response_model=MovingOut)
async def create_moving(data: MovingCreateReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    distance = 0.0
    if data.origin_lat is not None and data.destination_lat is not None:
        distance = road_distance_km(data.origin_lat, data.origin_lng or 0.0, data.destination_lat, data.destination_lng or 0.0)
    fee = await quote_moving_fee(db_sess, distance, data.truck_size)

    coupon_discount = 0.0
    coupon_id = None
    if data.coupon_code:
        applied = await validate_rider_coupon(db_sess, data.coupon_code, "moving", fee, user.user_id)
        coupon_discount = applied["discount"]
        coupon_id = applied["coupon_id"]
        fee = applied["fare_after"]

    booking = MovingBooking(
        booking_id=f"mv_{uuid.uuid4().hex[:12]}",
        customer_id=user.user_id,
        move_type=data.move_type,
        origin_lat=data.origin_lat,
        origin_lng=data.origin_lng,
        origin_address=data.origin_address,
        destination_lat=data.destination_lat,
        destination_lng=data.destination_lng,
        destination_address=data.destination_address,
        items=json.dumps(data.items) if data.items else None,
        truck_size=data.truck_size,
        move_date=data.move_date,
        distance_km=round(distance, 1) if distance else None,
        quote_amount=fee,
        payment_method=data.payment_method,
        note=data.note,
        status="requested",
    )
    db_sess.add(booking)
    if coupon_id:
        await redeem(db_sess, coupon_id, user.user_id, booking.booking_id, coupon_discount)
    await db_sess.commit()
    await db_sess.refresh(booking)

    payload = moving_out(booking)
    payload["event"] = "moving.request"
    lat = data.origin_lat if data.origin_lat is not None else 6.5244
    lng = data.origin_lng if data.origin_lng is not None else 3.3792
    await ws_manager.broadcast_job_request(payload, lat, lng)
    log_event("moving", "moving.requested", user_id=user.user_id, booking_id=booking.booking_id, fee=fee, distance_km=round(distance, 1) if distance else None, truck_size=data.truck_size)
    return payload


@router.get("/moving", response_model=list[MovingOut])
async def list_moving(role: str = "customer", user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    q = select(MovingBooking)
    if role == "customer":
        q = q.where(MovingBooking.customer_id == user.user_id)
    elif role == "driver":
        q = q.where(MovingBooking.driver_id == user.user_id)
    else:
        q = q.where((MovingBooking.customer_id == user.user_id) | (MovingBooking.driver_id == user.user_id))
    q = q.order_by(MovingBooking.created_at.desc()).limit(50)
    res = await db_sess.execute(q)
    return [moving_out(b) for b in res.scalars().all()]


@router.get("/moving/{booking_id}", response_model=MovingOut)
async def get_moving(booking_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    if booking.customer_id != user.user_id and booking.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not part of this booking")
    driver = None
    driver_name = None
    if booking.driver_id:
        res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == booking.driver_id))
        driver = res.scalar_one_or_none()
        res2 = await db_sess.execute(select(User).where(User.user_id == booking.driver_id))
        du = res2.scalar_one_or_none()
        driver_name = du.name if du else None
    return moving_out(booking, driver, driver_name)


@router.post("/moving/{booking_id}/accept", response_model=MovingOut)
async def accept_moving(booking_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    driver = res.scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=400, detail="Register as a driver first")

    result = await db_sess.execute(
        update(MovingBooking)
        .where(MovingBooking.booking_id == booking_id, MovingBooking.status == "requested")
        .values(driver_id=user.user_id, status="accepted", updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount == 0:
        booking = await load_moving(db_sess, booking_id)
        return moving_out(booking)

    booking = await load_moving(db_sess, booking_id)
    driver.is_online = 1
    await notify(db_sess, booking.customer_id, "Mover assigned", f"{user.name} accepted your move on {booking.move_date}.", category="moving", data={"booking_id": booking.booking_id})
    await db_sess.commit()
    log_event("moving", "moving.accepted", user_id=user.user_id, booking_id=booking.booking_id)

    out = moving_out(booking, driver, user.name)
    await ws_manager.send_to_rider(booking.customer_id, {**out, "event": "moving.accepted"})
    return out


@router.post("/moving/{booking_id}/start", response_model=MovingOut)
async def start_moving(booking_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    if booking.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if booking.status != "accepted":
        raise HTTPException(status_code=400, detail=f"Cannot start from state '{booking.status}'")
    booking.status = "in_progress"
    booking.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("moving", "moving.started", user_id=user.user_id, booking_id=booking.booking_id)
    await ws_manager.send_to_rider(booking.customer_id, {"event": "moving.status", "booking_id": booking.booking_id, "status": "in_progress", "message": "Move in progress"})
    return moving_out(booking)


@router.post("/moving/{booking_id}/complete", response_model=MovingOut)
async def complete_moving(booking_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    if booking.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if booking.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Cannot complete from state '{booking.status}'")
    booking.status = "completed"
    booking.payment_status = "paid"
    booking.updated_at = datetime.now(timezone.utc)

    if (booking.payment_method or "cash") == "wallet":
        await debit(db_sess, booking.customer_id, booking.quote_amount, category="moving_payment", reference=booking.booking_id)
    bonus = await driver_bonus(db_sess, "moving", booking.quote_amount, booking.driver_id)
    await credit(db_sess, booking.driver_id, driver_share(booking.quote_amount) + bonus, category="earnings", reference=booking.booking_id, meta={"booking_id": booking.booking_id, "gross": booking.quote_amount, "bonus": bonus})

    await db_sess.commit()

    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == booking.driver_id))
    driver = res.scalar_one_or_none()
    if driver:
        driver.trips_completed = (driver.trips_completed or 0) + 1
    await notify(db_sess, booking.customer_id, "Move completed", f"Your move is complete. Total ₦{booking.quote_amount:,.0f}.", category="moving", data={"booking_id": booking.booking_id})
    await db_sess.commit()

    await ws_manager.send_to_rider(booking.customer_id, {"event": "moving.completed", "booking_id": booking.booking_id, "fee": booking.quote_amount})
    log_event("moving", "moving.completed", user_id=user.user_id, booking_id=booking.booking_id, fee=booking.quote_amount)
    return moving_out(booking)


@router.post("/moving/{booking_id}/cancel", response_model=MovingOut)
async def cancel_moving(booking_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    if booking.customer_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the customer can cancel")
    if booking.status not in ("requested", "accepted"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel from state '{booking.status}'")
    booking.status = "cancelled"
    booking.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("moving", "moving.cancelled", user_id=user.user_id, booking_id=booking.booking_id)
    if booking.driver_id:
        await ws_manager.send_to_driver(booking.driver_id, {"event": "moving.cancelled", "booking_id": booking.booking_id})
    else:
        await ws_manager.send_to_rider(user.user_id, {"event": "moving.status", "booking_id": booking.booking_id, "status": "cancelled"})
    return moving_out(booking)


@router.post("/moving/{booking_id}/payment-method", response_model=MovingOut)
async def set_moving_payment_method(booking_id: str, data: MovingPaymentReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    if booking.customer_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the customer can set payment method")
    booking.payment_method = data.payment_method
    booking.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return moving_out(booking)
