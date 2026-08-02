"""Driver registration, availability and discovery."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..core.geo import haversine_km
from ..core.logging import log_event
from ..core.realtime import ws_manager
from ..db import get_db
from ..models.driver import DriverProfile
from ..models.user import User
from ..schemas.drivers import DriverProfileOut, DriverRegisterReq, DriverStatusReq
from ..services.drivers import driver_profile_out

router = APIRouter(prefix="/api", tags=["drivers"])


@router.post("/drivers/register", response_model=DriverProfileOut)
async def driver_register(data: DriverRegisterReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    profile = DriverProfile(
        user_id=user.user_id,
        vehicle_type=data.vehicle_type,
        vehicle_plate=data.vehicle_plate,
        vehicle_color=data.vehicle_color,
        vehicle_model=data.vehicle_model,
        phone=data.phone,
    )
    await db_sess.merge(profile)
    user.role = "driver"
    await db_sess.commit()
    log_event("drivers", "driver.registered", user_id=user.user_id, vehicle_type=data.vehicle_type, vehicle_plate=data.vehicle_plate)
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    return driver_profile_out(res.scalar_one(), user.name)


@router.get("/drivers/me", response_model=DriverProfileOut)
async def driver_me(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Not registered as a driver")
    return driver_profile_out(profile, user.name)


@router.post("/drivers/status", response_model=DriverProfileOut)
async def driver_status(data: DriverStatusReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Not registered as a driver")
    if data.is_online and profile.verification_status != "verified":
        raise HTTPException(
            status_code=403,
            detail=f"Driver not verified (status: {profile.verification_status}). Complete verification to go online.",
        )
    profile.is_online = 1 if data.is_online else 0
    profile.current_lat = data.lat
    profile.current_lng = data.lng
    profile.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    ws_manager.update_driver_meta(user.user_id, data.lat, data.lng)
    log_event("drivers", "driver.online" if data.is_online else "driver.offline", user_id=user.user_id, lat=data.lat, lng=data.lng)
    return driver_profile_out(profile, user.name)


@router.get("/drivers/nearby", response_model=list[DriverProfileOut])
async def drivers_nearby(lat: float, lng: float, vehicle_type: Optional[str] = None, radius_km: float = 10.0, db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.is_online == 1))
    out = []
    for d in res.scalars().all():
        if vehicle_type and d.vehicle_type != vehicle_type:
            continue
        if d.current_lat is None or d.current_lng is None:
            continue
        if haversine_km(lat, lng, d.current_lat, d.current_lng) <= radius_km:
            out.append(driver_profile_out(d))
    return out
