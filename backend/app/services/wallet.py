"""Wallet helpers: balance, credit/debit, earnings, serializers."""
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import PLATFORM_COMMISSION_PERCENT
from ..core.logging import log_event
from ..models.wallet import Wallet, WalletTransaction

# Earnings shown on completion = gross fare minus platform commission.
DRIVER_SHARE_PERCENT = 100 - PLATFORM_COMMISSION_PERCENT


def driver_share(gross: float) -> float:
    return round(gross * DRIVER_SHARE_PERCENT / 100.0, 2)


async def get_or_create_wallet(db_sess: AsyncSession, user_id: str) -> Wallet:
    res = await db_sess.execute(select(Wallet).where(Wallet.user_id == user_id))
    wallet = res.scalar_one_or_none()
    if wallet:
        return wallet
    wallet = Wallet(wallet_id=f"wl_{uuid.uuid4().hex[:12]}", user_id=user_id, balance=0.0)
    db_sess.add(wallet)
    await db_sess.flush()
    return wallet


async def credit(
    db_sess: AsyncSession,
    user_id: str,
    amount: float,
    category: str = "general",
    reference: Optional[str] = None,
    meta: Optional[dict] = None,
) -> Wallet:
    wallet = await get_or_create_wallet(db_sess, user_id)
    wallet.balance = round((wallet.balance or 0.0) + amount, 2)
    wallet.updated_at = datetime.now(timezone.utc)
    db_sess.add(
        WalletTransaction(
            txn_id=f"tx_{uuid.uuid4().hex[:12]}",
            wallet_id=wallet.wallet_id,
            user_id=user_id,
            amount=round(amount, 2),
            txn_type="credit",
            category=category,
            status="success",
            reference=reference,
            meta=json.dumps(meta) if meta else None,
        )
    )
    log_event("wallet", "wallet.credit", user_id=user_id, amount=round(amount, 2), category=category, reference=reference, balance=wallet.balance)
    return wallet


async def debit(
    db_sess: AsyncSession,
    user_id: str,
    amount: float,
    category: str = "general",
    reference: Optional[str] = None,
    meta: Optional[dict] = None,
) -> Wallet:
    wallet = await get_or_create_wallet(db_sess, user_id)
    if (wallet.balance or 0.0) < amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    wallet.balance = round(wallet.balance - amount, 2)
    wallet.updated_at = datetime.now(timezone.utc)
    db_sess.add(
        WalletTransaction(
            txn_id=f"tx_{uuid.uuid4().hex[:12]}",
            wallet_id=wallet.wallet_id,
            user_id=user_id,
            amount=round(amount, 2),
            txn_type="debit",
            category=category,
            status="success",
            reference=reference,
            meta=json.dumps(meta) if meta else None,
        )
    )
    log_event("wallet", "wallet.debit", user_id=user_id, amount=round(amount, 2), category=category, reference=reference, balance=wallet.balance)
    return wallet


async def wallet_transactions(db_sess: AsyncSession, user_id: str, limit: int = 50) -> List[WalletTransaction]:
    res = await db_sess.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user_id)
        .order_by(WalletTransaction.created_at.desc())
        .limit(limit)
    )
    return list(res.scalars().all())


def txn_out(t: WalletTransaction) -> dict:
    meta = None
    if t.meta:
        try:
            meta = json.loads(t.meta)
        except (ValueError, TypeError):
            meta = None
    return {
        "txn_id": t.txn_id,
        "amount": t.amount,
        "txn_type": t.txn_type,
        "category": t.category,
        "status": t.status,
        "reference": t.reference,
        "meta": meta,
        "created_at": t.created_at,
    }
