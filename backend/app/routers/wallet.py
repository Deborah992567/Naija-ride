"""Wallet: balance, top-up (Paystack), driver earnings, withdrawals."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import PAYSTACK_SECRET_KEY, PLATFORM_COMMISSION_PERCENT
from ..core.deps import current_user, require_admin
from ..core.logging import log_event
from ..db import get_db
from ..models.user import User
from ..models.wallet import Wallet, WalletTransaction, WithdrawalRequest
from ..schemas.wallet import (
    AdminWithdrawalReviewReq,
    EarningsOut,
    TopupOut,
    TopupReq,
    WalletDetailOut,
    WalletOut,
    WithdrawalOut,
    WithdrawReq,
)
from ..services.audit import log_audit
from ..services.notifications import notify
from ..services.wallet import credit, debit, driver_share, txn_out, wallet_transactions

logger = logging.getLogger("naija-ride")
router = APIRouter(prefix="/api", tags=["wallet"])


@router.get("/wallet", response_model=WalletDetailOut)
async def get_wallet(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Wallet).where(Wallet.user_id == user.user_id))
    wallet = res.scalar_one_or_none()
    if not wallet:
        wallet = Wallet(wallet_id=f"wl_{uuid.uuid4().hex[:12]}", user_id=user.user_id, balance=0.0)
        db_sess.add(wallet)
        await db_sess.commit()
    txns = await wallet_transactions(db_sess, user.user_id)
    return WalletDetailOut(
        wallet_id=wallet.wallet_id,
        balance=wallet.balance,
        currency=wallet.currency,
        transactions=[txn_out(t) for t in txns],
    )


@router.post("/wallet/topup", response_model=TopupOut)
async def topup(data: TopupReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    payment_id = f"py_{uuid.uuid4().hex[:12]}"
    reference = f"NM-TP-{uuid.uuid4().hex[:12].upper()}"
    authorization_url = f"https://paystack.com/pay/{reference}"

    if PAYSTACK_SECRET_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.paystack.co/transaction/initialize",
                    headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"},
                    json={
                        "email": user.email,
                        "amount": int(data.amount * 100),
                        "reference": reference,
                        "metadata": {"purpose": "wallet_topup", "payment_id": payment_id},
                    },
                )
                if resp.status_code == 200:
                    j = resp.json()
                    authorization_url = j.get("data", {}).get("authorization_url", authorization_url)
        except Exception as e:
            logger.warning("Paystack topup initialize failed: %s", e)

    db_sess.add(
        WalletTransaction(
            txn_id=f"tx_{uuid.uuid4().hex[:12]}",
            wallet_id=f"wl_topup_{user.user_id[-8:]}_{payment_id[-6:]}",
            user_id=user.user_id,
            amount=data.amount,
            txn_type="credit",
            category="topup",
            status="pending",
            reference=reference,
            meta=f'{{"payment_id":"{payment_id}","purpose":"wallet_topup"}}',
        )
    )
    await db_sess.commit()
    log_event("wallet", "wallet.topup_initiated", user_id=user.user_id, amount=data.amount, reference=reference)
    return TopupOut(payment_id=payment_id, authorization_url=authorization_url, reference=reference)


@router.post("/wallet/topup/verify")
async def verify_topup(reference: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user.user_id, WalletTransaction.reference == reference)
        .order_by(WalletTransaction.created_at.desc())
    )
    txn = res.scalars().first()
    if not txn or txn.category != "topup":
        raise HTTPException(status_code=404, detail="Top-up not found")
    if txn.status == "success":
        return {"ok": True, "status": "success", "balance": (await _balance(db_sess, user.user_id))}

    if PAYSTACK_SECRET_KEY and reference:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://api.paystack.co/transaction/verify/{reference}",
                    headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"},
                )
                if resp.status_code == 200 and resp.json().get("data", {}).get("status") == "success":
                    await credit(db_sess, user.user_id, txn.amount, category="topup", reference=reference, meta={"payment_id": txn.meta})
                    txn.status = "success"
                    await db_sess.commit()
                    return {"ok": True, "status": "success", "balance": (await _balance(db_sess, user.user_id))}
                return {"ok": False, "status": resp.json().get("data", {}).get("status", "pending")}
        except Exception as e:
            logger.warning("Paystack topup verify failed: %s", e)
            return {"ok": False, "status": "unverified"}

    # Dev mode (no key): mark success so the flow is testable end-to-end.
    await credit(db_sess, user.user_id, txn.amount, category="topup", reference=reference, meta={"payment_id": txn.meta})
    txn.status = "success"
    await db_sess.commit()
    return {"ok": True, "status": "success", "balance": (await _balance(db_sess, user.user_id))}


@router.get("/wallet/earnings", response_model=EarningsOut)
async def driver_earnings(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(func.coalesce(func.sum(WalletTransaction.amount), 0), func.count(WalletTransaction.txn_id)).where(
            WalletTransaction.user_id == user.user_id,
            WalletTransaction.category == "earnings",
            WalletTransaction.status == "success",
        )
    )
    total, jobs = res.one()
    return EarningsOut(
        commission_percent=float(PLATFORM_COMMISSION_PERCENT),
        total_earnings=round(float(total), 2),
        job_count=int(jobs),
    )


@router.post("/wallet/withdraw", response_model=WithdrawalOut)
async def request_withdrawal(data: WithdrawReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    res = await db_sess.execute(select(Wallet).where(Wallet.user_id == user.user_id))
    wallet = res.scalar_one_or_none()
    if not wallet or (wallet.balance or 0.0) < data.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    req = WithdrawalRequest(
        request_id=f"wd_{uuid.uuid4().hex[:12]}",
        user_id=user.user_id,
        amount=data.amount,
        bank_name=data.bank_name,
        bank_account_name=data.bank_account_name,
        bank_account_number=data.bank_account_number,
        status="pending",
    )
    db_sess.add(req)
    await db_sess.commit()
    log_event("wallet", "wallet.withdrawal_requested", user_id=user.user_id, request_id=req.request_id, amount=data.amount)
    return req


@router.get("/wallet/withdrawals", response_model=list[WithdrawalOut])
async def my_withdrawals(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(WithdrawalRequest).where(WithdrawalRequest.user_id == user.user_id).order_by(WithdrawalRequest.created_at.desc())
    )
    return list(res.scalars().all())


@router.get("/admin/withdrawals", response_model=list[WithdrawalOut])
async def admin_list_withdrawals(status: Optional[str] = None, user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    q = select(WithdrawalRequest)
    if status:
        q = q.where(WithdrawalRequest.status == status)
    q = q.order_by(WithdrawalRequest.created_at.desc())
    res = await db_sess.execute(q)
    return list(res.scalars().all())


@router.post("/admin/withdrawals/{request_id}/review", response_model=WithdrawalOut)
async def review_withdrawal(request_id: str, data: AdminWithdrawalReviewReq, user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(WithdrawalRequest).where(WithdrawalRequest.request_id == request_id))
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Withdrawal request not found")
    if data.decision not in ("approved", "rejected", "paid"):
        raise HTTPException(status_code=400, detail="Decision must be approved, rejected or paid")

    if data.decision == "paid":
        if req.status != "approved":
            raise HTTPException(status_code=400, detail="Request must be approved before payout")
        # Payout: debit the driver's wallet on transfer.
        await debit(db_sess, req.user_id, req.amount, category="withdrawal", reference=req.request_id)
        req.status = "paid"
    elif data.decision == "approved":
        if req.status != "pending":
            raise HTTPException(status_code=400, detail="Request must be pending to approve")
        req.status = "approved"
    else:
        if req.status not in ("pending", "approved"):
            raise HTTPException(status_code=400, detail="Request already processed")
        req.status = "rejected"

    req.admin_note = data.note
    req.processed_at = datetime.now(timezone.utc)
    await log_audit(db_sess, user.user_id, f"withdrawal.{data.decision}", "withdrawal", req.request_id, {"amount": req.amount})
    log_event("wallet", "withdrawal.reviewed", admin_id=user.user_id, request_id=req.request_id, decision=data.decision, amount=req.amount)
    await notify(
        db_sess,
        req.user_id,
        "Withdrawal update",
        f"Your ₦{req.amount:,.0f} withdrawal is now {req.status}.",
        category="wallet",
        data={"request_id": req.request_id, "amount": req.amount, "status": req.status},
    )
    await db_sess.commit()
    return req


async def _balance(db_sess: AsyncSession, user_id: str) -> float:
    res = await db_sess.execute(select(Wallet).where(Wallet.user_id == user_id))
    wallet = res.scalar_one_or_none()
    return round(wallet.balance, 2) if wallet else 0.0
