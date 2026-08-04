"""DB-backed configurable pricing rules (replaces the static FARE_CONFIG)."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class PricingRule(Base):
    __tablename__ = "pricing_rules"
    rule_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    vehicle_type: Mapped[str] = mapped_column(String(20), index=True)  # car | delivery | moving | van | truck
    city: Mapped[Optional[str]] = mapped_column(String(100), index=True)  # null = nationwide default
    base_fare: Mapped[float] = mapped_column(Float)
    per_km: Mapped[float] = mapped_column(Float)
    per_minute: Mapped[float] = mapped_column(Float)
    min_fare: Mapped[float] = mapped_column(Float, default=0.0)
    night_multiplier: Mapped[float] = mapped_column(Float, default=1.0)  # applied between 20:00-05:00
    surge_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    active: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
