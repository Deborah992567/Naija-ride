"""Driver helpers shared by the drivers router."""
import math
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.geo import AVG_SPEED_KPH, haversine_km
from ..models.driver import DriverProfile
from ..schemas.drivers import DriverProfileOut


def driver_profile_out(d: DriverProfile, user_name: Optional[str] = None) -> DriverProfileOut:
    return DriverProfileOut(
        user_id=d.user_id,
        name=user_name,
        profile_photo=d.profile_photo,
        vehicle_type=d.vehicle_type,
        vehicle_plate=d.vehicle_plate,
        vehicle_color=d.vehicle_color,
        vehicle_model=d.vehicle_model,
        phone=d.phone,
        is_online=d.is_online,
        current_lat=d.current_lat,
        current_lng=d.current_lng,
        rating=round(d.rating or 5.0, 1),
        trips_completed=d.trips_completed or 0,
    )


async def nearest_driver_eta(db_sess: AsyncSession, lat: float, lng: float, vehicle_type: str, max_km: float = 15.0) -> Optional[int]:
    res = await db_sess.execute(select(DriverProfile).where(
        DriverProfile.is_online == 1,
        DriverProfile.vehicle_type == vehicle_type,
    ))
    best_km: Optional[float] = None
    for d in res.scalars().all():
        if d.current_lat is None or d.current_lng is None:
            continue
        km = haversine_km(d.current_lat, d.current_lng, lat, lng)
        if km <= max_km and (best_km is None or km < best_km):
            best_km = km
    if best_km is None:
        return None
    return max(2, int(math.ceil(best_km / AVG_SPEED_KPH * 60)))
