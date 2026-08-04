"""Job chat: message history + send (real-time delivery over WebSocket).

Conversations are scoped to a ride, delivery, or moving job between the
customer (requester) and the provider (driver / courier / mover).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..db import get_db
from ..models.driver import DriverProfile
from ..models.user import User
from ..schemas.chat import ChatContactOut, MessageOut, MessageReq
from ..services.chat import (
    assert_delivery_party,
    assert_moving_party,
    assert_ride_party,
    entity_messages,
    message_out,
    send_delivery_message,
    send_moving_message,
    send_ride_message,
)
from ..services.delivery import load_delivery
from ..services.moving import load_moving
from ..services.rides import load_ride

router = APIRouter(prefix="/api", tags=["chat"])


async def _driver_contact(db_sess: AsyncSession, driver_id: str) -> dict:
    du = (await db_sess.execute(select(User).where(User.user_id == driver_id))).scalar_one_or_none()
    dp = (await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == driver_id))).scalar_one_or_none()
    return {
        "name": du.name if du else None,
        "phone": (dp.phone if dp else None) or (du.phone if du else None),
        "role": "provider",
    }


async def _customer_contact(db_sess: AsyncSession, user_id: str, fallback_phone: str | None = None) -> dict:
    u = (await db_sess.execute(select(User).where(User.user_id == user_id))).scalar_one_or_none()
    return {
        "name": u.name if u else None,
        "phone": (u.phone if u else None) or fallback_phone,
        "role": "customer",
    }


@router.get("/rides/{ride_id}/messages", response_model=list[MessageOut])
async def get_ride_messages(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    assert_ride_party(ride, user.user_id)
    messages = await entity_messages(db_sess, ride_id=ride_id)
    return [message_out(m) for m in messages]


@router.post("/rides/{ride_id}/messages", response_model=MessageOut)
async def post_ride_message(ride_id: str, data: MessageReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    assert_ride_party(ride, user.user_id)
    m = await send_ride_message(db_sess, ride, user.user_id, data.body)
    await db_sess.commit()
    return message_out(m)


@router.get("/delivery/{delivery_id}/messages", response_model=list[MessageOut])
async def get_delivery_messages(delivery_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    delivery = await load_delivery(db_sess, delivery_id)
    assert_delivery_party(delivery, user.user_id)
    messages = await entity_messages(db_sess, delivery_id=delivery_id)
    return [message_out(m) for m in messages]


@router.post("/delivery/{delivery_id}/messages", response_model=MessageOut)
async def post_delivery_message(delivery_id: str, data: MessageReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    delivery = await load_delivery(db_sess, delivery_id)
    assert_delivery_party(delivery, user.user_id)
    m = await send_delivery_message(db_sess, delivery, user.user_id, data.body)
    await db_sess.commit()
    return message_out(m)


@router.get("/moving/{booking_id}/messages", response_model=list[MessageOut])
async def get_moving_messages(booking_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    assert_moving_party(booking, user.user_id)
    messages = await entity_messages(db_sess, moving_id=booking_id)
    return [message_out(m) for m in messages]


@router.post("/moving/{booking_id}/messages", response_model=MessageOut)
async def post_moving_message(booking_id: str, data: MessageReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    booking = await load_moving(db_sess, booking_id)
    assert_moving_party(booking, user.user_id)
    m = await send_moving_message(db_sess, booking, user.user_id, data.body)
    await db_sess.commit()
    return message_out(m)


@router.get("/chat/contact/{entity_type}/{entity_id}", response_model=ChatContactOut)
async def get_chat_contact(entity_type: str, entity_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    """Resolve the other party's name + phone for the current user on a job."""
    if entity_type == "ride":
        ride = await load_ride(db_sess, entity_id)
        assert_ride_party(ride, user.user_id)
        if user.user_id == ride.rider_id:
            if ride.driver_id:
                return await _driver_contact(db_sess, ride.driver_id)
            raise HTTPException(status_code=404, detail="Driver not assigned yet")
        return await _customer_contact(db_sess, ride.rider_id)
    if entity_type == "delivery":
        delivery = await load_delivery(db_sess, entity_id)
        assert_delivery_party(delivery, user.user_id)
        if user.user_id == delivery.requester_id:
            if delivery.driver_id:
                return await _driver_contact(db_sess, delivery.driver_id)
            raise HTTPException(status_code=404, detail="Courier not assigned yet")
        return await _customer_contact(db_sess, delivery.requester_id, fallback_phone=delivery.recipient_phone)
    if entity_type == "moving":
        booking = await load_moving(db_sess, entity_id)
        assert_moving_party(booking, user.user_id)
        if user.user_id == booking.customer_id:
            if booking.driver_id:
                return await _driver_contact(db_sess, booking.driver_id)
            raise HTTPException(status_code=404, detail="Mover not assigned yet")
        return await _customer_contact(db_sess, booking.customer_id)
    raise HTTPException(status_code=400, detail="Unknown entity type")
