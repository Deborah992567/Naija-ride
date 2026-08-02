"""Delivery/dispatch service: quote, create, dispatch over WS, lifecycle."""
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
from ..models.delivery import DeliveryOrder
from ..models.driver import DriverProfile
from ..models.user import User
from ..schemas.delivery import (
    DeliveryCreateReq,
    DeliveryOut,
    DeliveryPaymentReq,
    DeliveryQuoteOut,
    DeliveryQuoteReq,
)
from ..services.delivery import delivery_out, load_delivery, quote_delivery_fee
from ..services.drivers import nearest_driver_eta
from ..services.coupons import driver_bonus, redeem, validate_rider_coupon
from ..services.notifications import notify
from ..services.wallet import credit, debit, driver_share

router = APIRouter(prefix="/api", tags=["delivery"])

ACTIVE = ("requested", "accepted", "picked_up", "in_transit")


@router.post("/delivery/quote", response_model=DeliveryQuoteOut)
async def delivery_quote(data: DeliveryQuoteReq, db_sess: AsyncSession = Depends(get_db)):
    distance = road_distance_km(data.pickup_lat, data.pickup_lng, data.dropoff_lat, data.dropoff_lng)
    fee = await quote_delivery_fee(db_sess, distance, data.weight_kg)
    eta = distance_minutes(distance)
    log_event("delivery", "delivery.quote", distance_km=round(distance, 1), fee=fee, weight_kg=data.weight_kg)
    return DeliveryQuoteOut(
        distance_km=round(distance, 1),
        fee=fee,
        eta_minutes=eta,
        allowed=True,
        reason=None,
    )


@router.post("/delivery", response_model=DeliveryOut)
async def create_delivery(data: DeliveryCreateReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    distance = road_distance_km(data.pickup_lat, data.pickup_lng, data.dropoff_lat, data.dropoff_lng)
    fee = await quote_delivery_fee(db_sess, distance, data.weight_kg)

    coupon_discount = 0.0
    coupon_id = None
    if data.coupon_code:
        applied = await validate_rider_coupon(db_sess, data.coupon_code, "delivery", fee, user.user_id)
        coupon_discount = applied["discount"]
        coupon_id = applied["coupon_id"]
        fee = applied["fare_after"]

    order = DeliveryOrder(
        delivery_id=f"dl_{uuid.uuid4().hex[:12]}",
        requester_id=user.user_id,
        package_type=data.package_type,
        weight_kg=data.weight_kg,
        pickup_lat=data.pickup_lat,
        pickup_lng=data.pickup_lng,
        pickup_address=data.pickup_address,
        dropoff_lat=data.dropoff_lat,
        dropoff_lng=data.dropoff_lng,
        dropoff_address=data.dropoff_address,
        recipient_name=data.recipient_name,
        recipient_phone=data.recipient_phone,
        distance_km=round(distance, 1),
        delivery_fee=fee,
        payment_method=data.payment_method,
        note=data.note,
        status="requested",
    )
    db_sess.add(order)
    if coupon_id:
        await redeem(db_sess, coupon_id, user.user_id, order.delivery_id, coupon_discount)
    await db_sess.commit()
    await db_sess.refresh(order)

    payload = delivery_out(order)
    payload["event"] = "delivery.request"
    await ws_manager.broadcast_job_request(payload, data.pickup_lat, data.pickup_lng)
    log_event("delivery", "delivery.requested", user_id=user.user_id, delivery_id=order.delivery_id, fee=fee, distance_km=round(distance, 1), package_type=data.package_type)
    return payload


@router.get("/delivery", response_model=list[DeliveryOut])
async def list_deliveries(role: str = "requester", user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    q = select(DeliveryOrder)
    if role == "requester":
        q = q.where(DeliveryOrder.requester_id == user.user_id)
    elif role == "driver":
        q = q.where(DeliveryOrder.driver_id == user.user_id)
    else:
        q = q.where((DeliveryOrder.requester_id == user.user_id) | (DeliveryOrder.driver_id == user.user_id))
    q = q.order_by(DeliveryOrder.created_at.desc()).limit(50)
    res = await db_sess.execute(q)
    return [delivery_out(d) for d in res.scalars().all()]


@router.get("/delivery/{delivery_id}", response_model=DeliveryOut)
async def get_delivery(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    order = await load_delivery(db_sess, delivery_id)
    if order.requester_id != user.user_id and order.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not part of this delivery")
    driver = None
    driver_name = None
    if order.driver_id:
        res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == order.driver_id))
        driver = res.scalar_one_or_none()
        res2 = await db_sess.execute(select(User).where(User.user_id == order.driver_id))
        du = res2.scalar_one_or_none()
        driver_name = du.name if du else None
    return delivery_out(order, driver, driver_name)


@router.post("/delivery/{delivery_id}/accept", response_model=DeliveryOut)
async def accept_delivery(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    driver = res.scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=400, detail="Register as a driver first")

    result = await db_sess.execute(
        update(DeliveryOrder)
        .where(DeliveryOrder.delivery_id == delivery_id, DeliveryOrder.status == "requested")
        .values(driver_id=user.user_id, status="accepted", updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount == 0:
        order = await load_delivery(db_sess, delivery_id)
        return delivery_out(order)

    order = await load_delivery(db_sess, delivery_id)
    driver.is_online = 1
    await notify(db_sess, order.requester_id, "Courier assigned", f"{user.name} will pick up your {order.package_type} delivery.", category="delivery", data={"delivery_id": order.delivery_id})
    await db_sess.commit()
    log_event("delivery", "delivery.accepted", user_id=user.user_id, delivery_id=order.delivery_id)

    out = delivery_out(order, driver, user.name)
    await ws_manager.send_to_rider(order.requester_id, {**out, "event": "delivery.accepted"})
    return out


@router.post("/delivery/{delivery_id}/pickup", response_model=DeliveryOut)
async def pickup_delivery(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    order = await load_delivery(db_sess, delivery_id)
    if order.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if order.status != "accepted":
        raise HTTPException(status_code=400, detail=f"Cannot pick up from state '{order.status}'")
    order.status = "picked_up"
    order.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("delivery", "delivery.picked_up", user_id=user.user_id, delivery_id=order.delivery_id)
    await ws_manager.send_to_rider(order.requester_id, {"event": "delivery.status", "delivery_id": order.delivery_id, "status": "picked_up", "message": "Your parcel has been picked up"})
    return delivery_out(order)


@router.post("/delivery/{delivery_id}/start", response_model=DeliveryOut)
async def start_delivery(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    order = await load_delivery(db_sess, delivery_id)
    if order.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if order.status != "picked_up":
        raise HTTPException(status_code=400, detail=f"Cannot start from state '{order.status}'")
    order.status = "in_transit"
    order.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("delivery", "delivery.in_transit", user_id=user.user_id, delivery_id=order.delivery_id)
    await ws_manager.send_to_rider(order.requester_id, {"event": "delivery.status", "delivery_id": order.delivery_id, "status": "in_transit", "message": "Your parcel is on the way"})
    return delivery_out(order)


@router.post("/delivery/{delivery_id}/complete", response_model=DeliveryOut)
async def complete_delivery(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    order = await load_delivery(db_sess, delivery_id)
    if order.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if order.status != "in_transit":
        raise HTTPException(status_code=400, detail=f"Cannot complete from state '{order.status}'")
    order.status = "delivered"
    order.payment_status = "paid"
    order.updated_at = datetime.now(timezone.utc)

    if (order.payment_method or "cash") == "wallet":
        await debit(db_sess, order.requester_id, order.delivery_fee, category="delivery_payment", reference=order.delivery_id)
    bonus = await driver_bonus(db_sess, "delivery", order.delivery_fee, order.driver_id)
    await credit(db_sess, order.driver_id, driver_share(order.delivery_fee) + bonus, category="earnings", reference=order.delivery_id, meta={"delivery_id": order.delivery_id, "gross": order.delivery_fee, "bonus": bonus})

    await db_sess.commit()

    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == order.driver_id))
    driver = res.scalar_one_or_none()
    if driver:
        driver.trips_completed = (driver.trips_completed or 0) + 1
    await notify(db_sess, order.requester_id, "Delivery completed", f"Your {order.package_type} delivery has arrived. Fee ₦{order.delivery_fee:,.0f}.", category="delivery", data={"delivery_id": order.delivery_id})
    await db_sess.commit()

    await ws_manager.send_to_rider(order.requester_id, {"event": "delivery.completed", "delivery_id": order.delivery_id, "fee": order.delivery_fee})
    log_event("delivery", "delivery.completed", user_id=user.user_id, delivery_id=order.delivery_id, fee=order.delivery_fee)
    return delivery_out(order)


@router.post("/delivery/{delivery_id}/cancel", response_model=DeliveryOut)
async def cancel_delivery(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    order = await load_delivery(db_sess, delivery_id)
    if order.requester_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the requester can cancel")
    if order.status not in ("requested", "accepted"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel from state '{order.status}'")
    order.status = "cancelled"
    order.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("delivery", "delivery.cancelled", user_id=user.user_id, delivery_id=order.delivery_id)
    if order.driver_id:
        await ws_manager.send_to_driver(order.driver_id, {"event": "delivery.cancelled", "delivery_id": order.delivery_id})
    else:
        await ws_manager.send_to_rider(user.user_id, {"event": "delivery.status", "delivery_id": order.delivery_id, "status": "cancelled"})
    return delivery_out(order)


@router.post("/delivery/{delivery_id}/payment-method", response_model=DeliveryOut)
async def set_delivery_payment_method(delivery_id: str, data: DeliveryPaymentReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    order = await load_delivery(db_sess, delivery_id)
    if order.requester_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the requester can set payment method")
    order.payment_method = data.payment_method
    order.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return delivery_out(order)
