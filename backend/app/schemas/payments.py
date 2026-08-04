
from pydantic import BaseModel


class CardPayReq(BaseModel):
    ride_id: str
    amount: float


class CardPayOut(BaseModel):
    payment_id: str
    authorization_url: str
    reference: str


class TransferOut(BaseModel):
    payment_id: str
    account_name: str
    account_number: str
    bank_name: str
    amount: float
    reference: str
    status: str
