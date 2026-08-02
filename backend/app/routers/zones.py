"""Zones: where specific vehicle types are restricted."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas.zones import ZoneInfo
from ..services.rides import get_zone_rules

router = APIRouter(prefix="/api", tags=["zones"])


@router.get("/zones", response_model=list[ZoneInfo])
async def list_zones(db_sess: AsyncSession = Depends(get_db)):
    rules = await get_zone_rules(db_sess)
    return [
        ZoneInfo(
            zone_name=z.zone_name,
            city=z.city,
            disallowed_vehicle_types=[v.strip() for v in (z.disallowed_vehicle_types or "").split(",") if v.strip()],
        )
        for z in rules
    ]
