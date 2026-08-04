from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ReferralApplyReq(BaseModel):
    code: str


class ReferralUserOut(BaseModel):
    user_id: str
    name: Optional[str] = None
    email: str
    created_at: datetime


class ReferralOut(BaseModel):
    referral_code: str
    referral_link: str
    referrer_reward: int
    referred_reward: int
    referrals: List[ReferralUserOut]
    total_rewards: float


class ReferralApplyOut(BaseModel):
    referrer_user_id: str
    referrer_reward: int
    reward: int
