"""Support tickets and ticket messages."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    ticket_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(30), default="other")  # ride|delivery|moving|payment|driver|wallet|other
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|pending|resolved|closed
    priority: Mapped[str] = mapped_column(String(20), default="normal")  # low|normal|high|urgent
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class SupportMessage(Base):
    __tablename__ = "support_messages"
    message_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(60), index=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    body: Mapped[str] = mapped_column(Text)
    is_agent: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
