"""Safety: emergency SOS, emergency contacts, live trip sharing."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import SHARE_BASE_URL
from ..core.deps import current_user
from ..db import get_db
from ..models.driver import DriverProfile
from ..models.safety import EmergencyContact, EmergencyRecord, TripShare
from ..models.user import User
from ..schemas.safety import (
    EmergencyContactOut,
    EmergencyContactReq,
    EmergencyOut,
    EmergencyReq,
    SharedTripOut,
    TripShareOut,
)
from ..services.notifications import notify
from ..services.rides import load_ride

router = APIRouter(prefix="/api", tags=["safety"])


def contact_out(c: EmergencyContact) -> dict:
    return {"contact_id": c.contact_id, "name": c.name, "phone": c.phone, "created_at": c.created_at}


def emergency_out(e: EmergencyRecord) -> dict:
    return {
        "emergency_id": e.emergency_id,
        "ride_id": e.ride_id,
        "lat": e.lat,
        "lng": e.lng,
        "message": e.message,
        "status": e.status,
        "created_at": e.created_at,
    }


# ---- Emergency contacts ----


@router.get("/safety/contacts", response_model=list[EmergencyContactOut])
async def list_contacts(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(EmergencyContact).where(EmergencyContact.user_id == user.user_id).order_by(EmergencyContact.created_at.desc())
    )
    return [contact_out(c) for c in res.scalars().all()]


@router.post("/safety/contacts", response_model=EmergencyContactOut)
async def add_contact(data: EmergencyContactReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    if len(data.phone) < 7:
        raise HTTPException(status_code=400, detail="Phone number looks too short")
    c = EmergencyContact(contact_id=f"ct_{uuid.uuid4().hex[:12]}", user_id=user.user_id, name=data.name, phone=data.phone)
    db_sess.add(c)
    await db_sess.commit()
    return contact_out(c)


@router.delete("/safety/contacts/{contact_id}")
async def remove_contact(contact_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(EmergencyContact).where(EmergencyContact.contact_id == contact_id))
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    if c.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your contact")
    await db_sess.delete(c)
    await db_sess.commit()
    return {"ok": True}


# ---- Emergency / SOS ----


@router.post("/safety/emergency", response_model=EmergencyOut)
async def raise_emergency(data: EmergencyReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = None
    if data.ride_id:
        ride = await load_ride(db_sess, data.ride_id)
        if ride.rider_id != user.user_id and ride.driver_id != user.user_id:
            raise HTTPException(status_code=403, detail="Not part of this ride")

    record = EmergencyRecord(
        emergency_id=f"em_{uuid.uuid4().hex[:12]}",
        user_id=user.user_id,
        ride_id=data.ride_id,
        lat=data.lat,
        lng=data.lng,
        message=data.message,
        status="raised",
    )
    db_sess.add(record)

    # Alert the other party on an active ride, and log for dispatch review.
    if ride and ride.driver_id and ride.driver_id != user.user_id:
        await notify(
            db_sess,
            ride.driver_id,
            "Emergency alert",
            f"A rider raised an SOS on ride {ride.ride_id}.",
            category="safety",
            data={"emergency_id": record.emergency_id, "ride_id": ride.ride_id, "lat": data.lat, "lng": data.lng},
        )
    if ride and ride.rider_id and ride.rider_id != user.user_id:
        await notify(
            db_sess,
            ride.rider_id,
            "Emergency alert",
            f"A driver raised an SOS on ride {ride.ride_id}.",
            category="safety",
            data={"emergency_id": record.emergency_id, "ride_id": ride.ride_id},
        )

    from ..services.audit import log_audit

    await log_audit(
        db_sess,
        actor_id=user.user_id,
        action="safety.emergency",
        entity_type="emergency_record",
        entity_id=record.emergency_id,
        meta={"ride_id": data.ride_id, "message": data.message},
    )
    await db_sess.commit()
    return emergency_out(record)


@router.post("/safety/emergency/{emergency_id}/resolve", response_model=EmergencyOut)
async def resolve_emergency(emergency_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(EmergencyRecord).where(EmergencyRecord.emergency_id == emergency_id))
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Emergency record not found")
    if record.user_id != user.user_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Not your emergency record")
    record.status = "resolved"
    record.resolved_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return emergency_out(record)


@router.get("/safety/emergency/my", response_model=list[EmergencyOut])
async def my_emergencies(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(EmergencyRecord).where(EmergencyRecord.user_id == user.user_id).order_by(EmergencyRecord.created_at.desc())
    )
    return [emergency_out(e) for e in res.scalars().all()]


# ---- Live trip sharing ----


@router.post("/rides/{ride_id}/share", response_model=TripShareOut)
async def share_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the rider can share this trip")
    token = uuid.uuid4().hex[:24]
    share = TripShare(
        share_id=f"sh_{uuid.uuid4().hex[:12]}",
        ride_id=ride_id,
        user_id=user.user_id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=12),
    )
    db_sess.add(share)
    await db_sess.commit()
    return TripShareOut(
        share_id=share.share_id,
        ride_id=ride_id,
        token=token,
        url=f"{SHARE_BASE_URL.rstrip('/')}/api/rides/share/{token}",
        expires_at=share.expires_at,
    )


@router.get("/rides/share/{token}", response_model=SharedTripOut)
async def shared_trip(token: str, db_sess: AsyncSession = Depends(get_db)):
    """Public read-only view for someone a rider shared their trip with."""
    res = await db_sess.execute(select(TripShare).where(TripShare.token == token))
    share = res.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")
    if share.expires_at and share.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link expired")
    ride = await load_ride(db_sess, share.ride_id)
    rider_name = None
    driver_name = None
    driver = None
    rider_res = await db_sess.execute(select(User).where(User.user_id == ride.rider_id))
    rider = rider_res.scalar_one_or_none()
    if rider:
        rider_name = rider.name
    if ride.driver_id:
        dres = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == ride.driver_id))
        driver = dres.scalar_one_or_none()
        if driver:
            ures = await db_sess.execute(select(User).where(User.user_id == ride.driver_id))
            du = ures.scalar_one_or_none()
            driver_name = du.name if du else None
    return SharedTripOut(
        ride_id=ride.ride_id,
        status=ride.status,
        pickup_address=ride.pickup_address,
        dropoff_address=ride.dropoff_address,
        rider_name=rider_name,
        driver_name=driver_name,
        vehicle_type=ride.vehicle_type if not driver else driver.vehicle_type,
        vehicle_plate=driver.vehicle_plate if driver else None,
        lat=driver.current_lat if driver else None,
        lng=driver.current_lng if driver else None,
        eta_minutes=ride.driver_eta_minutes,
    )
