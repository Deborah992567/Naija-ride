from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel

from .rides import DriverOut

MovingType = Literal["home", "office", "apartment"]
TruckSize = Literal["small", "medium", "large"]
MovingPaymentMethod = Literal["cash", "card", "transfer", "wallet"]


class MovingQuoteReq(BaseModel):
    origin_lat: float
    origin_lng: float
    destination_lat: float
    destination_lng: float
    move_type: MovingType = "home"
    truck_size: TruckSize = "medium"


class MovingQuoteOut(BaseModel):
    distance_km: float
    fee: float
    eta_minutes: int
    allowed: bool
    reason: Optional[str]


class MovingCreateReq(BaseModel):
    origin_address: str
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    destination_address: str
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    move_type: MovingType = "home"
    truck_size: TruckSize = "medium"
    move_date: Optional[date] = None
    items: Optional[List[str]] = None
    note: Optional[str] = None
    payment_method: MovingPaymentMethod = "cash"
    coupon_code: Optional[str] = None


class MovingOut(BaseModel):
    booking_id: str
    customer_id: str
    driver: Optional[DriverOut]
    move_type: str
    origin_lat: Optional[float]
    origin_lng: Optional[float]
    origin_address: str
    destination_lat: Optional[float]
    destination_lng: Optional[float]
    destination_address: str
    truck_size: Optional[str]
    move_date: Optional[date]
    distance_km: Optional[float]
    quote_amount: Optional[float]
    payment_method: Optional[str]
    payment_status: str
    status: str
    note: Optional[str]
    created_at: datetime


class MovingPaymentReq(BaseModel):
    payment_method: MovingPaymentMethod
