from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .zones import ZoneInfo

VehicleType = Literal["car", "bike"]
PaymentMethod = Literal["cash", "card", "transfer", "wallet"]


class EstimateReq(BaseModel):
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    vehicle_type: VehicleType


class EstimateOut(BaseModel):
    distance_km: float
    eta_minutes: int
    fare: float
    allowed: bool
    reason: Optional[str]
    zones: List[ZoneInfo]
    payment_methods: List[str]


class RideRequestReq(BaseModel):
    pickup_lat: float
    pickup_lng: float
    pickup_address: Optional[str] = None
    dropoff_lat: float
    dropoff_lng: float
    dropoff_address: Optional[str] = None
    vehicle_type: VehicleType
    payment_method: PaymentMethod = "cash"
    coupon_code: Optional[str] = None


class DriverOut(BaseModel):
    user_id: str
    name: Optional[str]
    rating: float
    trips_completed: int
    profile_photo: Optional[str] = None
    vehicle_type: str
    vehicle_plate: Optional[str]
    vehicle_color: Optional[str]
    vehicle_model: Optional[str]
    current_lat: Optional[float]
    current_lng: Optional[float]


class RideRequestOut(BaseModel):
    ride_id: str
    rider_id: str
    driver: Optional[DriverOut]
    vehicle_type: str
    pickup_lat: float
    pickup_lng: float
    pickup_address: Optional[str]
    dropoff_lat: float
    dropoff_lng: float
    dropoff_address: Optional[str]
    distance_km: float
    fare_estimate: float
    payment_method: Optional[str]
    status: str
    driver_eta_minutes: Optional[int]
    created_at: datetime


class TripOut(BaseModel):
    trip_id: str
    ride_id: str
    rider_id: str
    driver_id: str
    fare: float
    payment_method: str
    payment_status: str
    status: str
    rating_driver: Optional[int]
    rating_rider: Optional[int]
    started_at: datetime
    ended_at: Optional[datetime]


class PaymentMethodReq(BaseModel):
    payment_method: PaymentMethod


class RateReq(BaseModel):
    rating: int = Field(..., ge=1, le=5)


class DriverLocationPush(BaseModel):
    lat: float
    lng: float
