"""Coupons / promos and redemptions."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Coupon(Base):
    __tablename__ = "coupons"
    coupon_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255))
    discount_type: Mapped[str] = mapped_column(String(10), default="percent")  # percent|fixed
    discount_value: Mapped[float] = mapped_column(Float)
    audience: Mapped[str] = mapped_column(String(10), default="rider")  # rider|driver
    scope: Mapped[str] = mapped_column(String(20), default="ride")  # ride|delivery|moving|all
    min_trip_fare: Mapped[float] = mapped_column(Float, default=0.0)
    max_discount: Mapped[Optional[float]] = mapped_column(Float)
    valid_from: Mapped[datetime] = mapped_column(DateTime)
    valid_to: Mapped[datetime] = mapped_column(DateTime)
    max_uses: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unlimited
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class CouponRedemption(Base):
    __tablename__ = "coupon_redemptions"
    redemption_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    coupon_id: Mapped[str] = mapped_column(String(60), index=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    ride_id: Mapped[Optional[str]] = mapped_column(String(60), index=True)
    discount: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
