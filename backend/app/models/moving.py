"""House / office moving bookings."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Date, DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class MovingBooking(Base):
    __tablename__ = "moving_bookings"
    booking_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(50), index=True)
    driver_id: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    move_type: Mapped[str] = mapped_column(String(30), default="home")  # home|office|apartment
    origin_lat: Mapped[Optional[float]] = mapped_column(Float)
    origin_lng: Mapped[Optional[float]] = mapped_column(Float)
    origin_address: Mapped[str] = mapped_column(String(255))
    destination_lat: Mapped[Optional[float]] = mapped_column(Float)
    destination_lng: Mapped[Optional[float]] = mapped_column(Float)
    destination_address: Mapped[str] = mapped_column(String(255))
    items: Mapped[Optional[str]] = mapped_column(Text)  # JSON array of item descriptions
    truck_size: Mapped[Optional[str]] = mapped_column(String(20))  # small|medium|large
    move_date: Mapped[Optional[datetime]] = mapped_column(Date)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    quote_amount: Mapped[Optional[float]] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")  # cash|card|transfer|wallet
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid
    status: Mapped[str] = mapped_column(String(30), default="requested")  # requested|accepted|in_progress|completed|cancelled
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
