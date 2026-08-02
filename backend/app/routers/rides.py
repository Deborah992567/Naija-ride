"""Ride booking lifecycle: estimate, request, dispatch, track, complete, rate."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..core.geo import distance_minutes, road_distance_km
from ..core.logging import log_event
from ..core.realtime import ws_manager
from ..db import get_db
from ..models.driver import DriverProfile
from ..models.rides import RideRequest, Trip
from ..models.user import User
from ..schemas.rides import (
    EstimateOut,
    EstimateReq,
    PaymentMethodReq,
    RateReq,
    RideRequestOut,
    RideRequestReq,
    TripOut,
)
from ..schemas.zones import ZoneInfo
from ..services.drivers import nearest_driver_eta
from ..services.coupons import driver_bonus, redeem, validate_rider_coupon
from ..services.pricing import compute_fare, zone_disallowed
from ..services.rides import get_zone_rules, load_ride, ride_out, zones_at
from ..services.notifications import notify
from ..services.wallet import credit, debit, driver_share

router = APIRouter(prefix="/api", tags=["rides"])


@router.post("/rides/estimate", response_model=EstimateOut)
async def ride_estimate(data: EstimateReq, db_sess: AsyncSession = Depends(get_db)):
    distance = road_distance_km(data.pickup_lat, data.pickup_lng, data.dropoff_lat, data.dropoff_lng)
    minutes = distance_minutes(distance)
    fare = await compute_fare(db_sess, data.vehicle_type, distance, minutes)
    rules = await get_zone_rules(db_sess)
    zones = await zones_at(rules, data.pickup_lat, data.pickup_lng)
    banned_zone = zone_disallowed(zones, data.vehicle_type)
    await nearest_driver_eta(db_sess, data.pickup_lat, data.pickup_lng, data.vehicle_type)
    log_event("rides", "ride.estimate", vehicle_type=data.vehicle_type, distance_km=round(distance, 1), fare=fare, allowed=banned_zone is None)
    return EstimateOut(
        distance_km=round(distance, 1),
        eta_minutes=minutes,
        fare=fare,
        allowed=banned_zone is None,
        reason=f"{data.vehicle_type.capitalize()} is not allowed in {banned_zone}. Pick a different pickup point or vehicle type." if banned_zone else None,
        zones=[
            ZoneInfo(
                zone_name=z.zone_name,
                city=z.city,
                disallowed_vehicle_types=[v.strip() for v in (z.disallowed_vehicle_types or "").split(",") if v.strip()],
            )
            for z in zones
        ],
        payment_methods=["cash", "card", "transfer", "wallet"],
    )


@router.post("/rides", response_model=RideRequestOut)
async def request_ride(data: RideRequestReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    distance = road_distance_km(data.pickup_lat, data.pickup_lng, data.dropoff_lat, data.dropoff_lng)
    minutes = distance_minutes(distance)
    fare = await compute_fare(db_sess, data.vehicle_type, distance, minutes)

    rules = await get_zone_rules(db_sess)
    zones = await zones_at(rules, data.pickup_lat, data.pickup_lng)
    banned_zone = zone_disallowed(zones, data.vehicle_type)
    if banned_zone:
        raise HTTPException(status_code=400, detail=f"{data.vehicle_type.capitalize()} is not allowed in {banned_zone}.")

    driver_eta = await nearest_driver_eta(db_sess, data.pickup_lat, data.pickup_lng, data.vehicle_type)
    if driver_eta is None:
        raise HTTPException(status_code=400, detail=f"No {data.vehicle_type} drivers are online near you right now.")

    coupon_discount = 0.0
    coupon_id = None
    if data.coupon_code:
        applied = await validate_rider_coupon(db_sess, data.coupon_code, "ride", fare, user.user_id)
        coupon_discount = applied["discount"]
        coupon_id = applied["coupon_id"]
        fare = applied["fare_after"]

    ride = RideRequest(
        ride_id=f"rd_{uuid.uuid4().hex[:12]}",
        rider_id=user.user_id,
        vehicle_type=data.vehicle_type,
        pickup_lat=data.pickup_lat,
        pickup_lng=data.pickup_lng,
        pickup_address=data.pickup_address,
        dropoff_lat=data.dropoff_lat,
        dropoff_lng=data.dropoff_lng,
        dropoff_address=data.dropoff_address,
        distance_km=round(distance, 1),
        fare_estimate=fare,
        payment_method=data.payment_method,
        status="requested",
        driver_eta_minutes=driver_eta,
    )
    db_sess.add(ride)
    if coupon_id:
        await redeem(db_sess, coupon_id, user.user_id, ride.ride_id, coupon_discount)
    await db_sess.commit()
    await db_sess.refresh(ride)

    payload = ride_out(ride)
    payload["event"] = "ride.request"
    await ws_manager.broadcast_ride_request(payload, data.vehicle_type, data.pickup_lat, data.pickup_lng)
    log_event("rides", "ride.requested", user_id=user.user_id, ride_id=ride.ride_id, vehicle_type=data.vehicle_type, fare=fare, distance_km=round(distance, 1), payment_method=data.payment_method)
    return payload


@router.get("/rides", response_model=list[RideRequestOut])
async def list_rides(role: str = "customer", user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    """Recent rides for the current user (customer = rides they requested)."""
    q = select(RideRequest).order_by(RideRequest.created_at.desc()).limit(50)
    if role == "customer":
        q = q.where(RideRequest.rider_id == user.user_id)
    elif role == "driver":
        q = q.where(RideRequest.driver_id == user.user_id)
    else:
        q = q.where((RideRequest.rider_id == user.user_id) | (RideRequest.driver_id == user.user_id))
    res = await db_sess.execute(q)
    rides = list(res.scalars().all())

    out = []
    for ride in rides:
        driver = None
        driver_name = None
        if ride.driver_id:
            dres = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == ride.driver_id))
            driver = dres.scalar_one_or_none()
            ures = await db_sess.execute(select(User).where(User.user_id == ride.driver_id))
            du = ures.scalar_one_or_none()
            driver_name = du.name if du else None
        out.append(ride_out(ride, driver, driver_name))
    return out


@router.get("/rides/{ride_id}", response_model=RideRequestOut)
async def get_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id and ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not part of this ride")
    driver = None
    driver_name = None
    if ride.driver_id:
        res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == ride.driver_id))
        driver = res.scalar_one_or_none()
        res2 = await db_sess.execute(select(User).where(User.user_id == ride.driver_id))
        du = res2.scalar_one_or_none()
        driver_name = du.name if du else None
    return ride_out(ride, driver, driver_name)


@router.post("/rides/{ride_id}/cancel", response_model=RideRequestOut)
async def cancel_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the rider can cancel")
    if ride.status not in ("requested", "accepted", "arriving"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a ride in state '{ride.status}'")
    ride.status = "cancelled"
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("rides", "ride.cancelled", user_id=user.user_id, ride_id=ride.ride_id)
    if ride.driver_id:
        await ws_manager.send_to_driver(ride.driver_id, {"event": "ride.cancelled", "ride_id": ride.ride_id})
    else:
        await ws_manager.send_to_rider(user.user_id, {"event": "ride.status", "ride_id": ride.ride_id, "status": "cancelled"})
    return ride_out(ride)


@router.post("/rides/{ride_id}/accept", response_model=RideRequestOut)
async def accept_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    driver = res.scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=400, detail="Register as a driver first")

    result = await db_sess.execute(
        update(RideRequest)
        .where(RideRequest.ride_id == ride_id, RideRequest.status == "requested")
        .values(driver_id=user.user_id, status="accepted", updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount == 0:
        ride = await load_ride(db_sess, ride_id)
        return ride_out(ride)

    ride = await load_ride(db_sess, ride_id)
    driver.is_online = 1
    await notify(db_sess, ride.rider_id, "Driver accepted", f"{user.name} accepted your {ride.vehicle_type} request.", category="ride", data={"ride_id": ride.ride_id})
    await db_sess.commit()
    log_event("rides", "ride.accepted", user_id=user.user_id, ride_id=ride.ride_id, vehicle_type=ride.vehicle_type, fare=ride.fare_estimate)

    await ws_manager.send_to_rider(ride.rider_id, {
        "event": "ride.status",
        "ride_id": ride.ride_id,
        "status": "accepted",
        "message": f"Your {ride.vehicle_type} driver is on the way",
    })
    out = ride_out(ride, driver, user.name)
    await ws_manager.send_to_rider(ride.rider_id, {**out, "event": "ride.accepted"})
    return out


@router.post("/rides/{ride_id}/decline", response_model=RideRequestOut)
async def decline_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    log_event("rides", "ride.declined", user_id=user.user_id, ride_id=ride.ride_id)
    return ride_out(ride)


@router.post("/rides/{ride_id}/arrive", response_model=RideRequestOut)
async def arrive_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if ride.status != "accepted":
        raise HTTPException(status_code=400, detail=f"Cannot arrive from state '{ride.status}'")
    ride.status = "arriving"
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("rides", "ride.arriving", user_id=user.user_id, ride_id=ride.ride_id)
    await ws_manager.send_to_rider(ride.rider_id, {"event": "ride.status", "ride_id": ride.ride_id, "status": "arriving", "message": "Your driver has arrived"})
    return ride_out(ride)


@router.post("/rides/{ride_id}/start", response_model=RideRequestOut)
async def start_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if ride.status != "arriving":
        raise HTTPException(status_code=400, detail=f"Cannot start from state '{ride.status}'")
    ride.status = "in_progress"
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    log_event("rides", "ride.started", user_id=user.user_id, ride_id=ride.ride_id)
    await ws_manager.send_to_rider(ride.rider_id, {"event": "ride.status", "ride_id": ride.ride_id, "status": "in_progress", "message": "Trip started"})
    return ride_out(ride)


@router.post("/rides/{ride_id}/complete", response_model=TripOut)
async def complete_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if ride.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Cannot complete from state '{ride.status}'")

    trip = Trip(
        trip_id=f"tp_{uuid.uuid4().hex[:12]}",
        ride_id=ride.ride_id,
        rider_id=ride.rider_id,
        driver_id=ride.driver_id,
        fare=ride.fare_estimate,
        payment_method=ride.payment_method or "cash",
        status="completed",
    )
    ride.status = "completed"
    ride.updated_at = datetime.now(timezone.utc)
    db_sess.add(trip)

    # Settlement: wallet rides debit the rider, every completed ride credits driver earnings (gross minus commission).
    if (ride.payment_method or "cash") == "wallet":
        await debit(db_sess, ride.rider_id, trip.fare, category="ride_payment", reference=trip.trip_id, meta={"ride_id": ride.ride_id})
    bonus = await driver_bonus(db_sess, "ride", trip.fare, ride.driver_id)
    await credit(db_sess, ride.driver_id, driver_share(trip.fare) + bonus, category="earnings", reference=trip.trip_id, meta={"ride_id": ride.ride_id, "gross": trip.fare, "bonus": bonus})

    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == ride.driver_id))
    driver = res.scalar_one_or_none()
    if driver:
        driver.trips_completed = (driver.trips_completed or 0) + 1
    await notify(db_sess, ride.rider_id, "Trip completed", f"Your trip is complete. Fare ₦{trip.fare:,.0f}.", category="ride", data={"trip_id": trip.trip_id, "ride_id": ride.ride_id, "fare": trip.fare})
    await db_sess.commit()
    await db_sess.refresh(trip)

    await ws_manager.send_to_rider(ride.rider_id, {"event": "ride.completed", "trip_id": trip.trip_id, "ride_id": ride.ride_id, "fare": trip.fare})
    log_event("rides", "ride.completed", user_id=user.user_id, ride_id=ride.ride_id, trip_id=trip.trip_id, fare=trip.fare, payment_method=trip.payment_method)
    return trip


@router.post("/rides/{ride_id}/payment-method", response_model=RideRequestOut)
async def set_payment_method(ride_id: str, data: PaymentMethodReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the rider can set payment method")
    ride.payment_method = data.payment_method
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return ride_out(ride)


@router.post("/trips/{trip_id}/rate")
async def rate_trip(trip_id: str, data: RateReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Trip).where(Trip.trip_id == trip_id))
    trip = res.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if user.user_id == trip.rider_id:
        trip.rating_driver = data.rating
        res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == trip.driver_id))
        driver = res.scalar_one_or_none()
        if driver:
            total = driver.trips_completed or 0
            prev_sum = (driver.rating or 5.0) * total
            new_rating = (prev_sum + data.rating) / (total + 1) if total else float(data.rating)
            driver.rating = round(new_rating, 2)
    elif user.user_id == trip.driver_id:
        trip.rating_rider = data.rating
    else:
        raise HTTPException(status_code=403, detail="Not part of this trip")
    await db_sess.commit()
    log_event("rides", "ride.rated", user_id=user.user_id, trip_id=trip_id, rating=data.rating, rater_role="rider" if user.user_id == trip.rider_id else "driver")
    return {"ok": True, "rating": data.rating}
