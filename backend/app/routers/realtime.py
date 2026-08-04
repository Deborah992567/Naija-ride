"""WebSocket endpoint for live driver location + ride status."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update

from ..core.geo import eta_minutes_between
from ..core.realtime import decode_ws_user, ws_manager
from ..db import AsyncSessionLocal
from ..models.delivery import DeliveryOrder
from ..models.driver import DriverProfile
from ..models.moving import MovingBooking
from ..models.rides import RideRequest
from ..models.user import User
from ..services.chat import send_ride_message

logger = logging.getLogger("naija-ride")
router = APIRouter(prefix="/api", tags=["realtime"])


async def _auth_user(db_sess, user_id):
    res = await db_sess.execute(select(User).where(User.user_id == user_id))
    return res.scalar_one_or_none()


@router.websocket("/ws/chat")
async def chat_ws(websocket: WebSocket, token: str):
    """Dedicated chat socket: receives chat messages, receives live chat.message events."""
    user_id = decode_ws_user(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    db_sess = AsyncSessionLocal()
    try:
        if not await _auth_user(db_sess, user_id):
            await websocket.close(code=4401)
            return
        await websocket.accept()
        ws_manager.chat_clients[user_id] = websocket
        await websocket.send_json({"event": "connected", "role": "chat"})
        while True:
            msg = await websocket.receive_json()
            if msg.get("type") != "chat":
                continue
            ride_id = msg.get("ride_id")
            body = msg.get("body")
            if not ride_id or not body:
                continue
            res = await db_sess.execute(select(RideRequest).where(RideRequest.ride_id == ride_id))
            ride = res.scalar_one_or_none()
            if not ride:
                continue
            if ride.rider_id != user_id and ride.driver_id != user_id:
                continue
            await send_ride_message(db_sess, ride, user_id, str(body)[:1000])
            await db_sess.commit()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("chat_ws error: %s", e)
    finally:
        ws_manager.chat_clients.pop(user_id, None)
        await db_sess.close()


@router.websocket("/ws/rides")
async def rides_ws(websocket: WebSocket, token: str, role: str):
    user_id = decode_ws_user(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    db_sess = AsyncSessionLocal()
    try:
        res = await db_sess.execute(select(User).where(User.user_id == user_id))
        user = res.scalar_one_or_none()
        if not user:
            await websocket.close(code=4401)
            return
        if role == "driver":
            res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user_id))
            driver = res.scalar_one_or_none()
            if not driver:
                await websocket.close(code=4403)
                return
            await ws_manager.connect_driver(
                user_id,
                websocket,
                {"vehicle_type": driver.vehicle_type, "lat": driver.current_lat, "lng": driver.current_lng},
            )
            await websocket.send_json({"event": "connected", "role": "driver"})
        else:
            await ws_manager.connect_rider(user_id, websocket)
            await websocket.send_json({"event": "connected", "role": "rider"})

        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")
            if role == "driver" and msg_type == "location":
                lat = msg.get("lat")
                lng = msg.get("lng")
                if lat is not None and lng is not None:
                    await db_sess.execute(
                        update(DriverProfile).where(DriverProfile.user_id == user_id)
                        .values(current_lat=lat, current_lng=lng, updated_at=datetime.now(timezone.utc))
                    )
                    await db_sess.commit()
                    ws_manager.update_driver_meta(user_id, lat, lng)

                    # Read active jobs in a short-lived session so statuses are always fresh
                    # (the connection-scoped session holds a MySQL REPEATABLE READ snapshot).
                    job_sess = AsyncSessionLocal()
                    try:
                        res = await job_sess.execute(
                            select(RideRequest).where(
                                RideRequest.driver_id == user_id,
                                RideRequest.status.in_(["accepted", "arriving", "in_progress"]),
                            )
                        )
                        active_rides = list(res.scalars().all())
                        res = await job_sess.execute(
                            select(DeliveryOrder).where(
                                DeliveryOrder.driver_id == user_id,
                                DeliveryOrder.status.in_(["accepted", "picked_up", "in_transit"]),
                            )
                        )
                        active_deliveries = list(res.scalars().all())
                        res = await job_sess.execute(
                            select(MovingBooking).where(
                                MovingBooking.driver_id == user_id,
                                MovingBooking.status.in_(["accepted", "in_progress"]),
                            )
                        )
                        active_moves = list(res.scalars().all())
                    finally:
                        await job_sess.close()

                    # Rides: ETA to pickup while en route, ETA to dropoff while driving.
                    for ride in active_rides:
                        if ride.status == "in_progress":
                            target, tlat, tlng = "dropoff", ride.dropoff_lat, ride.dropoff_lng
                        else:
                            target, tlat, tlng = "pickup", ride.pickup_lat, ride.pickup_lng
                        eta = eta_minutes_between(lat, lng, tlat, tlng)
                        await ws_manager.send_to_rider(ride.rider_id, {
                            "event": "driver.location",
                            "ride_id": ride.ride_id,
                            "lat": lat,
                            "lng": lng,
                            "eta_minutes": eta,
                            "target": target,
                        })
                        await ws_manager.send_to_driver(user_id, {
                            "event": "driver.eta",
                            "ride_id": ride.ride_id,
                            "eta_minutes": eta,
                            "target": target,
                        })

                    # Deliveries: ETA to pickup until the parcel is collected, then to dropoff.
                    for order in active_deliveries:
                        if order.status == "accepted":
                            target, tlat, tlng = "pickup", order.pickup_lat, order.pickup_lng
                        else:
                            target, tlat, tlng = "dropoff", order.dropoff_lat, order.dropoff_lng
                        eta = eta_minutes_between(lat, lng, tlat, tlng)
                        await ws_manager.send_to_rider(order.requester_id, {
                            "event": "driver.location",
                            "delivery_id": order.delivery_id,
                            "lat": lat,
                            "lng": lng,
                            "eta_minutes": eta,
                            "target": target,
                        })
                        await ws_manager.send_to_driver(user_id, {
                            "event": "driver.eta",
                            "delivery_id": order.delivery_id,
                            "eta_minutes": eta,
                            "target": target,
                        })

                    # Moving: ETA to the origin until the move starts, then to destination.
                    for booking in active_moves:
                        if booking.status == "accepted":
                            target, tlat, tlng = "pickup", booking.origin_lat, booking.origin_lng
                        else:
                            target, tlat, tlng = "dropoff", booking.destination_lat, booking.destination_lng
                        if tlat is None or tlng is None:
                            continue
                        eta = eta_minutes_between(lat, lng, tlat, tlng)
                        await ws_manager.send_to_rider(booking.customer_id, {
                            "event": "driver.location",
                            "booking_id": booking.booking_id,
                            "lat": lat,
                            "lng": lng,
                            "eta_minutes": eta,
                            "target": target,
                        })
                        await ws_manager.send_to_driver(user_id, {
                            "event": "driver.eta",
                            "booking_id": booking.booking_id,
                            "eta_minutes": eta,
                            "target": target,
                        })
            elif msg_type == "chat":
                ride_id = msg.get("ride_id")
                body = msg.get("body")
                if ride_id and body:
                    res = await db_sess.execute(select(RideRequest).where(RideRequest.ride_id == ride_id))
                    ride = res.scalar_one_or_none()
                    if ride and (ride.rider_id == user_id or ride.driver_id == user_id):
                        await send_ride_message(db_sess, ride, user_id, str(body)[:1000])
                        await db_sess.commit()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("rides_ws error: %s", e)
    finally:
        if role == "driver":
            ws_manager.disconnect_driver(user_id)
        else:
            ws_manager.disconnect_rider(user_id)
        await db_sess.close()
