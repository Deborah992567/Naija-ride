from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

from .rides import DriverOut

DeliveryPackageType = Literal["parcel", "food", "document", "groceries", "other"]
DeliveryPaymentMethod = Literal["cash", "card", "transfer", "wallet"]


class DeliveryQuoteReq(BaseModel):
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    package_type: DeliveryPackageType = "parcel"
    weight_kg: Optional[float] = None


class DeliveryQuoteOut(BaseModel):
    distance_km: float
    fee: float
    eta_minutes: int
    allowed: bool
    reason: Optional[str]


class DeliveryCreateReq(BaseModel):
    pickup_lat: float
    pickup_lng: float
    pickup_address: Optional[str] = None
    dropoff_lat: float
    dropoff_lng: float
    dropoff_address: Optional[str] = None
    package_type: DeliveryPackageType = "parcel"
    weight_kg: Optional[float] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    note: Optional[str] = None
    payment_method: DeliveryPaymentMethod = "cash"
    coupon_code: Optional[str] = None


class DeliveryOut(BaseModel):
    delivery_id: str
    requester_id: str
    driver: Optional[DriverOut]
    package_type: str
    weight_kg: Optional[float]
    pickup_lat: float
    pickup_lng: float
    pickup_address: Optional[str]
    dropoff_lat: float
    dropoff_lng: float
    dropoff_address: Optional[str]
    recipient_name: Optional[str]
    recipient_phone: Optional[str]
    distance_km: float
    delivery_fee: float
    payment_method: Optional[str]
    payment_status: str
    status: str
    note: Optional[str]
    created_at: datetime


class DeliveryPaymentReq(BaseModel):
    payment_method: DeliveryPaymentMethod
