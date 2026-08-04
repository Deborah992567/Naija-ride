"""Delivery helpers shared by the delivery router."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.delivery import DeliveryOrder
from ..schemas.rides import DriverOut


async def quote_delivery_fee(
    db_sess: AsyncSession, distance_km: float, weight_kg: Optional[float] = None
) -> float:
    """Compute a delivery fee from the `delivery` pricing rule + weight surcharge."""
    from ..services.pricing import get_pricing_rules

    rules = await get_pricing_rules(db_sess, "delivery")
    if rules:
        rule = rules[0]
        base, per_km = rule.base_fare, rule.per_km
        min_fare = rule.min_fare or 0.0
    else:
        base, per_km, min_fare = 400, 90, 500.0

    weight_kg = weight_kg or 0.0
    weight_surcharge = max(0.0, weight_kg - 2.0) * 50  # ₦50 per kg over 2kg
    fee = base + per_km * distance_km + weight_surcharge
    fee = max(fee, min_fare)
    return round(fee, -1)


def delivery_out(d: DeliveryOrder, driver=None, driver_name: Optional[str] = None) -> dict:
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
        "delivery_id": d.delivery_id,
        "requester_id": d.requester_id,
        "driver": driver_payload,
        "package_type": d.package_type,
        "weight_kg": d.weight_kg,
        "pickup_lat": d.pickup_lat,
        "pickup_lng": d.pickup_lng,
        "pickup_address": d.pickup_address,
        "dropoff_lat": d.dropoff_lat,
        "dropoff_lng": d.dropoff_lng,
        "dropoff_address": d.dropoff_address,
        "recipient_name": d.recipient_name,
        "recipient_phone": d.recipient_phone,
        "distance_km": d.distance_km,
        "delivery_fee": d.delivery_fee,
        "payment_method": d.payment_method,
        "payment_status": d.payment_status,
        "status": d.status,
        "note": d.note,
        "created_at": d.created_at,
    }


async def load_delivery(db_sess: AsyncSession, delivery_id: str) -> DeliveryOrder:
    res = await db_sess.execute(select(DeliveryOrder).where(DeliveryOrder.delivery_id == delivery_id))
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return order
