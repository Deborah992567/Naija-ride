from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NotificationOut(BaseModel):
    notification_id: str
    title: str
    body: str
    category: str
    data: Optional[dict]
    read: bool
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int


class EmergencyContactReq(BaseModel):
    name: str
    phone: str


class EmergencyContactOut(BaseModel):
    contact_id: str
    name: str
    phone: str
    created_at: datetime


class EmergencyReq(BaseModel):
    ride_id: Optional[str] = None
    message: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class EmergencyOut(BaseModel):
    emergency_id: str
    ride_id: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    message: Optional[str]
    status: str
    created_at: datetime


class TripShareOut(BaseModel):
    share_id: str
    ride_id: str
    token: str
    url: str
    expires_at: Optional[datetime]


class SharedTripOut(BaseModel):
    ride_id: str
    status: str
    pickup_address: Optional[str]
    dropoff_address: Optional[str]
    rider_name: Optional[str]
    driver_name: Optional[str]
    vehicle_type: Optional[str]
    vehicle_plate: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    eta_minutes: Optional[int]
