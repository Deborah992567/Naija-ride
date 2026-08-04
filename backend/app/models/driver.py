from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class DriverProfile(Base):
    __tablename__ = "driver_profiles"
    user_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    vehicle_type: Mapped[str] = mapped_column(String(20), default="car")  # car | bike
    vehicle_plate: Mapped[Optional[str]] = mapped_column(String(30))
    vehicle_color: Mapped[Optional[str]] = mapped_column(String(50))
    vehicle_model: Mapped[Optional[str]] = mapped_column(String(100))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    is_online: Mapped[int] = mapped_column(Integer, default=0)
    current_lat: Mapped[Optional[float]] = mapped_column(Float)
    current_lng: Mapped[Optional[float]] = mapped_column(Float)
    rating: Mapped[float] = mapped_column(Float, default=5.0)
    trips_completed: Mapped[int] = mapped_column(Integer, default=0)
    # Driver verification (Stage 6)
    verification_status: Mapped[str] = mapped_column(String(20), default="unverified")  # unverified|pending|verified|rejected
    id_type: Mapped[Optional[str]] = mapped_column(String(30))  # national_id | nin | passport | driver_license
    id_number: Mapped[Optional[str]] = mapped_column(String(100))
    license_number: Mapped[Optional[str]] = mapped_column(String(100))
    license_expiry: Mapped[Optional[datetime]] = mapped_column(Date)
    profile_photo: Mapped[Optional[str]] = mapped_column(String(255))
    document_urls: Mapped[Optional[str]] = mapped_column(Text)  # JSON array of document URLs
    # Face liveness (Stage: liveness). none | passed | failed
    liveness_status: Mapped[str] = mapped_column(String(20), default="none")
    liveness_ref: Mapped[Optional[str]] = mapped_column(String(100))  # provider result / dev ref
    verification_note: Mapped[Optional[str]] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
