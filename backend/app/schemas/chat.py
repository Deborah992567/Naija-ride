from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MessageReq(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


class MessageOut(BaseModel):
    message_id: str
    ride_id: Optional[str]
    delivery_id: Optional[str]
    moving_id: Optional[str]
    sender_id: str
    recipient_id: Optional[str]
    body: str
    created_at: datetime


class ChatContactOut(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: str = "provider"
