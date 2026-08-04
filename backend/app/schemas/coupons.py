from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

Audience = Literal["rider", "driver"]
Scope = Literal["ride", "delivery", "moving", "all"]
DiscountType = Literal["percent", "fixed"]


class CouponCreateReq(BaseModel):
    code: str
    description: Optional[str] = None
    discount_type: DiscountType = "percent"
    discount_value: float
    audience: Audience = "rider"
    scope: Scope = "ride"
    min_trip_fare: float = 0
    max_discount: Optional[float] = None
    valid_from: datetime
    valid_to: datetime
    max_uses: int = 0


class CouponOut(BaseModel):
    coupon_id: str
    code: str
    description: Optional[str]
    discount_type: str
    discount_value: float
    audience: str
    scope: str
    min_trip_fare: float
    max_discount: Optional[float]
    valid_from: datetime
    valid_to: datetime
    max_uses: int
    used_count: int
    active: int


class CouponValidateReq(BaseModel):
    code: str
    scope: Scope = "ride"
    fare: float


class CouponValidateOut(BaseModel):
    coupon_id: str
    code: str
    discount: float
    fare_after: float
