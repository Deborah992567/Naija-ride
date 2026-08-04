"""Delivery / dispatch orders (parcels, food, documents)."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class DeliveryOrder(Base):
    __tablename__ = "delivery_orders"
    delivery_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    requester_id: Mapped[str] = mapped_column(String(50), index=True)
    driver_id: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    package_type: Mapped[str] = mapped_column(String(30), default="parcel")  # parcel|food|document|groceries|other
    weight_kg: Mapped[Optional[float]] = mapped_column(Float)
    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[Optional[str]] = mapped_column(String(255))
    dropoff_lat: Mapped[float] = mapped_column(Float)
    dropoff_lng: Mapped[float] = mapped_column(Float)
    dropoff_address: Mapped[Optional[str]] = mapped_column(String(255))
    recipient_name: Mapped[Optional[str]] = mapped_column(String(100))
    recipient_phone: Mapped[Optional[str]] = mapped_column(String(30))
    distance_km: Mapped[float] = mapped_column(Float)
    delivery_fee: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")  # cash|card|transfer|wallet
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid
    status: Mapped[str] = mapped_column(String(30), default="requested")  # requested|accepted|picked_up|in_transit|delivered|cancelled
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
