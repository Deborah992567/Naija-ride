from typing import Literal, Optional

from pydantic import BaseModel


class DriverRegisterReq(BaseModel):
    vehicle_type: Literal["car", "bike"]
    vehicle_plate: Optional[str] = None
    vehicle_color: Optional[str] = None
    vehicle_model: Optional[str] = None
    phone: Optional[str] = None


class DriverProfileOut(BaseModel):
    user_id: str
    name: Optional[str]
    profile_photo: Optional[str] = None
    vehicle_type: str
    vehicle_plate: Optional[str]
    vehicle_color: Optional[str]
    vehicle_model: Optional[str]
    phone: Optional[str]
    is_online: int
    current_lat: Optional[float]
    current_lng: Optional[float]
    rating: float
    trips_completed: int


class DriverStatusReq(BaseModel):
    is_online: bool
    lat: float
    lng: float
