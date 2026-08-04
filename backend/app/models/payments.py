from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class PaymentRecord(Base):
    __tablename__ = "payments"
    payment_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    ride_id: Mapped[str] = mapped_column(String(60), index=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    amount: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(20))  # cash | card | transfer
    provider_ref: Mapped[Optional[str]] = mapped_column(String(255))  # paystack reference / transfer ref
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|success|failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
