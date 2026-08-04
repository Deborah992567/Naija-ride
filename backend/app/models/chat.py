from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Message(Base):
    """Customer-provider chat message scoped to a ride, delivery, or moving job."""

    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(String(60), unique=True)
    ride_id: Mapped[Optional[str]] = mapped_column(String(60), index=True)
    delivery_id: Mapped[Optional[str]] = mapped_column(String(60), index=True)
    moving_id: Mapped[Optional[str]] = mapped_column(String(60), index=True)
    sender_id: Mapped[str] = mapped_column(String(50), index=True)
    recipient_id: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    body: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
