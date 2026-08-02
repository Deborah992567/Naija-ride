"""Payments: card (Paystack), transfer details, verification."""
import logging
import os
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import PAYSTACK_SECRET_KEY
from ..core.deps import current_user
from ..core.logging import log_event
from ..db import get_db
from ..models.payments import PaymentRecord
from ..models.rides import RideRequest
from ..models.user import User
from ..schemas.payments import CardPayOut, CardPayReq, TransferOut
from ..services.rides import load_ride

logger = logging.getLogger("naija-ride")
router = APIRouter(prefix="/api", tags=["payments"])


@router.post("/payments/card", response_model=CardPayOut)
async def initiate_card_payment(data: CardPayReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, data.ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your ride")
    payment_id = f"py_{uuid.uuid4().hex[:12]}"
    reference = f"NM-{uuid.uuid4().hex[:12].upper()}"
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
                        "metadata": {"ride_id": data.ride_id, "payment_id": payment_id},
                    },
                )
                if resp.status_code == 200:
                    j = resp.json()
                    authorization_url = j.get("data", {}).get("authorization_url", authorization_url)
        except Exception as e:
            logger.warning("Paystack initialize failed: %s", e)

    payment = PaymentRecord(
        payment_id=payment_id,
        ride_id=data.ride_id,
        user_id=user.user_id,
        amount=data.amount,
        method="card",
        provider_ref=reference,
        status="pending",
    )
    db_sess.add(payment)
    await db_sess.commit()
    log_event("payments", "payment.card_initiated", user_id=user.user_id, payment_id=payment_id, ride_id=data.ride_id, amount=data.amount, reference=reference)
    return CardPayOut(payment_id=payment_id, authorization_url=authorization_url, reference=reference)


@router.post("/payments/card/verify")
async def verify_card_payment(payment_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(PaymentRecord).where(PaymentRecord.payment_id == payment_id))
    payment = res.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your payment")
    if payment.status == "success":
        return {"ok": True, "status": "success"}

    if PAYSTACK_SECRET_KEY and payment.provider_ref:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://api.paystack.co/transaction/verify/{payment.provider_ref}",
                    headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"},
                )
                if resp.status_code == 200 and resp.json().get("data", {}).get("status") == "success":
                    payment.status = "success"
                    await db_sess.commit()
                    log_event("payments", "payment.card_verified", user_id=user.user_id, payment_id=payment_id, status="success", provider="paystack")
                    return {"ok": True, "status": "success"}
                return {"ok": False, "status": resp.json().get("data", {}).get("status", "pending")}
        except Exception as e:
            logger.warning("Paystack verify failed: %s", e)
            return {"ok": False, "status": "unverified"}

    # Dev mode (no key): mark success so the flow is testable end-to-end.
    payment.status = "success"
    await db_sess.commit()
    log_event("payments", "payment.card_verified", user_id=user.user_id, payment_id=payment_id, status="success")
    return {"ok": True, "status": "success"}


@router.get("/payments", response_model=list[dict])
async def list_payments(role: str = "customer", user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    """Payment history for the current user (card/transfer payments)."""
    q = select(PaymentRecord, RideRequest).join(
        RideRequest, RideRequest.ride_id == PaymentRecord.ride_id
    ).order_by(PaymentRecord.created_at.desc()).limit(50)
    if role == "customer":
        q = q.where(PaymentRecord.user_id == user.user_id)
    else:
        q = q.where(RideRequest.driver_id == user.user_id)
    res = await db_sess.execute(q)
    out = []
    for p, ride in res.all():
        d = {c: getattr(p, c) for c in p.__dict__ if not c.startswith("_")}
        d["service_type"] = "ride"
        d["pickup_address"] = ride.pickup_address
        d["dropoff_address"] = ride.dropoff_address
        for k in ("created_at",):
            v = d.get(k)
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


@router.get("/payments/transfer/{ride_id}", response_model=TransferOut)
async def transfer_details(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your ride")
    payment_id = f"py_{uuid.uuid4().hex[:12]}"
    reference = f"NM-TR{ride.ride_id[-8:].upper()}"
    account_number = f"00{int(ride.ride_id.replace('rd_', ''), 16) % 10**9:09d}"[-10:]
    return TransferOut(
        payment_id=payment_id,
        account_name=user.name or user.email.split("@")[0],
        account_number=account_number,
        bank_name="NaijaMove Bank",
        amount=ride.fare_estimate,
        reference=reference,
        status="pending",
    )
