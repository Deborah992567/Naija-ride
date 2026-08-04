from typing import List

from pydantic import BaseModel


class ZoneInfo(BaseModel):
    zone_name: str
    city: str
    disallowed_vehicle_types: List[str]
