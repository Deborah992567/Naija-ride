from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class TopupReq(BaseModel):
    amount: float


class TopupOut(BaseModel):
    payment_id: str
    authorization_url: str
    reference: str


class TxnOut(BaseModel):
    txn_id: str
    amount: float
    txn_type: str
    category: str
    status: str
    reference: Optional[str]
    meta: Optional[dict]
    created_at: datetime


class WalletOut(BaseModel):
    wallet_id: str
    balance: float
    currency: str


class WalletDetailOut(BaseModel):
    wallet_id: str
    balance: float
    currency: str
    transactions: List[TxnOut]


class EarningsOut(BaseModel):
    commission_percent: float
    total_earnings: float
    job_count: int


class WithdrawReq(BaseModel):
    amount: float
    bank_name: str
    bank_account_name: str
    bank_account_number: str


class WithdrawalOut(BaseModel):
    request_id: str
    amount: float
    bank_name: Optional[str]
    bank_account_name: Optional[str]
    bank_account_number: Optional[str]
    status: str
    admin_note: Optional[str]
    processed_at: Optional[datetime]
    created_at: datetime


class AdminWithdrawalReviewReq(BaseModel):
    decision: str  # approved | rejected | paid
    note: Optional[str] = None
