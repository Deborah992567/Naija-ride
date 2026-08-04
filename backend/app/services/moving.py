"""Moving helpers shared by the moving router."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.moving import MovingBooking
from ..schemas.rides import DriverOut

TRUCK_MULTIPLIER = {"small": 1.0, "medium": 1.3, "large": 1.6}


async def quote_moving_fee(
    db_sess: AsyncSession, distance_km: float, truck_size: str = "medium"
) -> float:
    """Compute a moving quote from the `moving` pricing rule + truck size multiplier."""
    from ..services.pricing import get_pricing_rules

    rules = await get_pricing_rules(db_sess, "moving")
    if rules:
        rule = rules[0]
        base, per_km = rule.base_fare, rule.per_km
        min_fare = rule.min_fare or 0.0
    else:
        base, per_km, min_fare = 3000, 350, 10000.0

    fee = (base + per_km * distance_km) * TRUCK_MULTIPLIER.get(truck_size, 1.3)
    fee = max(fee, min_fare)
    return round(fee, -1)


def moving_out(b: MovingBooking, driver=None, driver_name: Optional[str] = None) -> dict:
    driver_payload = None
    if driver:
        driver_payload = DriverOut(
            user_id=driver.user_id,
            name=driver_name,
            rating=round(driver.rating or 5.0, 1),
            trips_completed=driver.trips_completed or 0,
            profile_photo=driver.profile_photo,
            vehicle_type=driver.vehicle_type,
            vehicle_plate=driver.vehicle_plate,
            vehicle_color=driver.vehicle_color,
            vehicle_model=driver.vehicle_model,
            current_lat=driver.current_lat,
            current_lng=driver.current_lng,
        )
    return {
        "booking_id": b.booking_id,
        "customer_id": b.customer_id,
        "driver": driver_payload,
        "move_type": b.move_type,
        "origin_lat": b.origin_lat,
        "origin_lng": b.origin_lng,
        "origin_address": b.origin_address,
        "destination_lat": b.destination_lat,
        "destination_lng": b.destination_lng,
        "destination_address": b.destination_address,
        "truck_size": b.truck_size,
        "move_date": b.move_date,
        "distance_km": b.distance_km,
        "quote_amount": b.quote_amount,
        "payment_method": b.payment_method,
        "payment_status": b.payment_status,
        "status": b.status,
        "note": b.note,
        "created_at": b.created_at,
    }


async def load_moving(db_sess: AsyncSession, booking_id: str) -> MovingBooking:
    res = await db_sess.execute(select(MovingBooking).where(MovingBooking.booking_id == booking_id))
    booking = res.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Moving booking not found")
    return booking
