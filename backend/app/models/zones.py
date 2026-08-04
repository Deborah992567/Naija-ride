from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ZoneRule(Base):
    __tablename__ = "zone_rules"
    zone_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    city: Mapped[str] = mapped_column(String(100), index=True)
    zone_name: Mapped[str] = mapped_column(String(100))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius_km: Mapped[float] = mapped_column(Float, default=3.0)
    disallowed_vehicle_types: Mapped[str] = mapped_column(String(255), default="")
