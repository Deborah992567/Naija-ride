from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel


class VerificationSubmitReq(BaseModel):
    id_type: Literal["national_id", "nin", "passport", "driver_license"]
    id_number: str
    license_number: Optional[str] = None
    license_expiry: Optional[date] = None
    profile_photo: Optional[str] = None
    document_urls: List[str] = []


class LivenessSubmitReq(BaseModel):
    selfie_url: str
    id_image_url: Optional[str] = None


class LivenessOut(BaseModel):
    status: str  # passed | failed
    liveness_status: str
    liveness_ref: Optional[str]
    message: str


class VerificationOut(BaseModel):
    user_id: str
    verification_status: str
    verification_note: Optional[str]
    id_type: Optional[str]
    id_number: Optional[str]
    license_number: Optional[str]
    license_expiry: Optional[date]
    profile_photo: Optional[str]
    document_urls: List[str]
    liveness_status: str
    liveness_ref: Optional[str]


class VerificationReviewReq(BaseModel):
    decision: Literal["verified", "rejected"]
    note: Optional[str] = None


class AdminVerificationOut(BaseModel):
    user_id: str
    name: Optional[str]
    email: str
    vehicle_type: str
    vehicle_plate: Optional[str]
    verification_status: str
    verification_note: Optional[str]
    id_type: Optional[str]
    id_number: Optional[str]
    license_number: Optional[str]
    license_expiry: Optional[date]
    document_urls: List[str]
    liveness_status: str
    liveness_ref: Optional[str]
    submitted_at: Optional[datetime]
