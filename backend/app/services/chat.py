"""Chat service: persist job-scoped messages and push them live to the other party.

Each conversation connects one customer (ride requester / delivery requester /
moving customer) with one provider (driver / courier / mover).
"""
import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.realtime import ws_manager
from ..models.chat import Message
from ..models.delivery import DeliveryOrder
from ..models.moving import MovingBooking
from ..models.rides import RideRequest


def message_out(m: Message) -> dict:
    return {
        "message_id": m.message_id,
        "ride_id": m.ride_id,
        "delivery_id": m.delivery_id,
        "moving_id": m.moving_id,
        "sender_id": m.sender_id,
        "recipient_id": m.recipient_id,
        "body": m.body,
        "created_at": m.created_at.isoformat(),
    }


def other_party(ride: RideRequest, user_id: str) -> Optional[str]:
    if ride.rider_id == user_id:
        return ride.driver_id
    if ride.driver_id == user_id:
        return ride.rider_id
    return None


def assert_ride_party(ride: RideRequest, user_id: str) -> None:
    if ride.rider_id != user_id and ride.driver_id != user_id:
        raise HTTPException(status_code=403, detail="Not part of this ride")


def assert_delivery_party(delivery: DeliveryOrder, user_id: str) -> None:
    if delivery.requester_id != user_id and delivery.driver_id != user_id:
        raise HTTPException(status_code=403, detail="Not part of this delivery")


def assert_moving_party(booking: MovingBooking, user_id: str) -> None:
    if booking.customer_id != user_id and booking.driver_id != user_id:
        raise HTTPException(status_code=403, detail="Not part of this moving job")


async def send_message(
    db_sess: AsyncSession,
    customer_id: str,
    provider_id: Optional[str],
    sender_id: str,
    body: str,
    *,
    ride_id: Optional[str] = None,
    delivery_id: Optional[str] = None,
    moving_id: Optional[str] = None,
) -> Message:
    """Persist a message (caller commits) and live-push it to the other party."""
    body = body.strip()[:1000]
    if not body:
        raise HTTPException(status_code=400, detail="Message body cannot be empty")
    if sender_id == customer_id:
        recipient = provider_id
    elif provider_id is not None and sender_id == provider_id:
        recipient = customer_id
    else:
        raise HTTPException(status_code=403, detail="Not part of this conversation")
    m = Message(
        message_id=f"msg_{uuid.uuid4().hex[:12]}",
        ride_id=ride_id,
        delivery_id=delivery_id,
        moving_id=moving_id,
        sender_id=sender_id,
        recipient_id=recipient,
        body=body,
    )
    db_sess.add(m)
    await db_sess.flush()
    if recipient:
        payload = {"event": "chat.message", "message": message_out(m)}
        if recipient == customer_id:
            await ws_manager.send_to_rider(recipient, payload)
        else:
            await ws_manager.send_to_driver(recipient, payload)
        await ws_manager.send_to_chat(recipient, payload)
    return m


async def send_ride_message(db_sess: AsyncSession, ride: RideRequest, sender_id: str, body: str) -> Message:
    return await send_message(db_sess, ride.rider_id, ride.driver_id, sender_id, body, ride_id=ride.ride_id)


async def send_delivery_message(db_sess: AsyncSession, delivery: DeliveryOrder, sender_id: str, body: str) -> Message:
    return await send_message(db_sess, delivery.requester_id, delivery.driver_id, sender_id, body, delivery_id=delivery.delivery_id)


async def send_moving_message(db_sess: AsyncSession, booking: MovingBooking, sender_id: str, body: str) -> Message:
    return await send_message(db_sess, booking.customer_id, booking.driver_id, sender_id, body, moving_id=booking.booking_id)


async def entity_messages(
    db_sess: AsyncSession,
    *,
    ride_id: Optional[str] = None,
    delivery_id: Optional[str] = None,
    moving_id: Optional[str] = None,
    limit: int = 200,
) -> list[Message]:
    filters = []
    if ride_id is not None:
        filters.append(Message.ride_id == ride_id)
    if delivery_id is not None:
        filters.append(Message.delivery_id == delivery_id)
    if moving_id is not None:
        filters.append(Message.moving_id == moving_id)
    stmt = select(Message)
    if filters:
        stmt = stmt.where(*filters)
    res = await db_sess.execute(stmt.order_by(Message.id.asc()).limit(max(1, min(limit, 500))))
    return list(res.scalars().all())
