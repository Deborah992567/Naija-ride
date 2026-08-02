from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    name: Optional[str] = None
    state: Optional[str] = None
    referral_code: Optional[str] = None


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionReq(BaseModel):
    session_id: str


class ForgotReq(BaseModel):
    email: EmailStr


class ForgotOut(BaseModel):
    ok: bool
    message: str
    reset_token: Optional[str] = None  # dev convenience — email the token in production


class ResetReq(BaseModel):
    token: str
    password: str = Field(..., min_length=8)


class PushTokenReq(BaseModel):
    push_token: str


class DeleteAccountReq(BaseModel):
    password: Optional[str] = None  # required for password providers


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    karma: int = 0
    provider: str
    role: str = "user"
    state: Optional[str] = None
    is_admin: int = 0
    referral_code: Optional[str] = None
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserOut


def user_to_out(u: dict) -> UserOut:
    return UserOut(
        user_id=u["user_id"],
        email=u["email"],
        name=u.get("name"),
        picture=u.get("picture"),
        karma=u.get("karma", 0),
        provider=u.get("provider", "password"),
        role=u.get("role", "user"),
        state=u.get("state"),
        is_admin=u.get("is_admin", 0),
        referral_code=u.get("referral_code"),
        created_at=u["created_at"],
    )
