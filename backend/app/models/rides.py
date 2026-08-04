from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class RideRequest(Base):
    __tablename__ = "ride_requests"
    ride_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    rider_id: Mapped[str] = mapped_column(String(50), index=True)
    driver_id: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    vehicle_type: Mapped[str] = mapped_column(String(20))
    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[Optional[str]] = mapped_column(String(255))
    dropoff_lat: Mapped[float] = mapped_column(Float)
    dropoff_lng: Mapped[float] = mapped_column(Float)
    dropoff_address: Mapped[Optional[str]] = mapped_column(String(255))
    distance_km: Mapped[float] = mapped_column(Float)
    fare_estimate: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[Optional[str]] = mapped_column(String(20))  # cash | card | transfer
    status: Mapped[str] = mapped_column(String(30), default="requested")  # requested|accepted|arriving|in_progress|completed|cancelled
    driver_eta_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Trip(Base):
    __tablename__ = "trips"
    trip_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    ride_id: Mapped[str] = mapped_column(String(60), index=True)
    rider_id: Mapped[str] = mapped_column(String(50), index=True)
    driver_id: Mapped[str] = mapped_column(String(50), index=True)
    fare: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress|completed
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    rating_driver: Mapped[Optional[int]] = mapped_column(Integer)  # rider rates driver (1-5)
    rating_rider: Mapped[Optional[int]] = mapped_column(Integer)  # driver rates rider (1-5)
