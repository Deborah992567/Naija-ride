"""Admin / system audit logs."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    audit_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)  # e.g. coupon.create, pricing.update
    entity_type: Mapped[Optional[str]] = mapped_column(String(50))
    entity_id: Mapped[Optional[str]] = mapped_column(String(60))
    meta: Mapped[Optional[str]] = mapped_column(Text)  # JSON payload
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
