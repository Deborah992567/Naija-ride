"""Ride helpers shared by the rides router."""
from dataclasses import dataclass
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import CACHE_TTL_ZONES
from ..core.cache import cache
from ..core.geo import haversine_km
from ..models.driver import DriverProfile
from ..models.rides import RideRequest
from ..models.zones import ZoneRule
from ..schemas.rides import DriverOut, RideRequestOut


@dataclass
class ZoneSnapshot:
    """Lightweight, serializable stand-in for a ZoneRule row (safe to cache)."""
    zone_name: str
    city: str
    lat: float
    lng: float
    radius_km: float
    disallowed_vehicle_types: Optional[str] = None


def _zone_to_snapshot(z: ZoneRule) -> ZoneSnapshot:
    return ZoneSnapshot(
        zone_name=z.zone_name,
        city=z.city,
        lat=z.lat,
        lng=z.lng,
        radius_km=z.radius_km,
        disallowed_vehicle_types=z.disallowed_vehicle_types,
    )


async def get_zone_rules(db_sess: AsyncSession) -> List[ZoneSnapshot]:
    """Zone rules, cached briefly so hot estimate/request paths skip the DB.

    The raw rows are serialized into snapshots before caching so the cache
    never holds live ORM objects tied to a closed session.
    """
    cached = cache.get("zones:rules")
    if cached is not None:
        return cached
    res = await db_sess.execute(select(ZoneRule))
    rules = [_zone_to_snapshot(z) for z in res.scalars().all()]
    cache.set("zones:rules", rules, ttl=CACHE_TTL_ZONES)
    return rules


def invalidate_zone_rules() -> None:
    cache.delete("zones:rules")


async def zones_at(rules: List[ZoneRule], lat: float, lng: float) -> List[ZoneRule]:
    return [z for z in rules if haversine_km(lat, lng, z.lat, z.lng) <= z.radius_km]


def ride_out(r: RideRequest, driver: Optional[DriverProfile] = None, driver_name: Optional[str] = None) -> dict:
    d = None
    if driver:
        d = DriverOut(
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
        "ride_id": r.ride_id,
        "rider_id": r.rider_id,
        "driver": d,
        "vehicle_type": r.vehicle_type,
        "pickup_lat": r.pickup_lat,
        "pickup_lng": r.pickup_lng,
        "pickup_address": r.pickup_address,
        "dropoff_lat": r.dropoff_lat,
        "dropoff_lng": r.dropoff_lng,
        "dropoff_address": r.dropoff_address,
        "distance_km": r.distance_km,
        "fare_estimate": r.fare_estimate,
        "payment_method": r.payment_method,
        "status": r.status,
        "driver_eta_minutes": r.driver_eta_minutes,
        "created_at": r.created_at,
    }


async def load_ride(db_sess: AsyncSession, ride_id: str) -> RideRequest:
    res = await db_sess.execute(select(RideRequest).where(RideRequest.ride_id == ride_id))
    ride = res.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    return ride
