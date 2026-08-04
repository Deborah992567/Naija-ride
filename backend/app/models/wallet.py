"""User wallets, transactions, and withdrawal requests."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Wallet(Base):
    __tablename__ = "wallets"
    wallet_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(10), default="NGN")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"
    txn_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    wallet_id: Mapped[str] = mapped_column(String(60), index=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    amount: Mapped[float] = mapped_column(Float)
    txn_type: Mapped[str] = mapped_column(String(10), default="credit")  # credit|debit
    category: Mapped[str] = mapped_column(String(30), default="general")  # topup|ride_payment|delivery_payment|moving_payment|earnings|withdrawal|refund|bonus
    status: Mapped[str] = mapped_column(String(20), default="success")  # pending|success|failed
    reference: Mapped[Optional[str]] = mapped_column(String(255))
    meta: Mapped[Optional[str]] = mapped_column(Text)  # JSON payload
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class WithdrawalRequest(Base):
    __tablename__ = "withdrawal_requests"
    request_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    amount: Mapped[float] = mapped_column(Float)
    bank_name: Mapped[Optional[str]] = mapped_column(String(100))
    bank_account_name: Mapped[Optional[str]] = mapped_column(String(100))
    bank_account_number: Mapped[Optional[str]] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected|paid
    admin_note: Mapped[Optional[str]] = mapped_column(String(255))
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
