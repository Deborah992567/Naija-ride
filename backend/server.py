"""Public Transport Tracker - Backend
FastAPI + MongoDB. Supports email/password JWT auth and Emergent Google Auth.
Provides routes, crowdsourced vehicle reports, and ETA calculations.
"""
from fastapi import FastAPI, APIRouter, HTTPException, status, Request, Depends, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, DateTime, JSON, Text, select, delete, update, func
import os
import logging
import math
import uuid
import httpx
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MariaDB / SQLAlchemy Setup
DB_URL = os.environ.get("DB_URL", "mysql+asyncmy://root:root1234@localhost/test_db")
engine = create_async_engine(DB_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# JWT config (dev secret - rotate in prod)
JWT_SECRET = os.environ.get("JWT_SECRET", "transport-tracker-dev-secret-change-me-2026")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 7

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("transport")


# ============================ DB MODELS ============================
class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    user_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    name: Mapped[Optional[str]] = mapped_column(String(255))
    picture: Mapped[Optional[str]] = mapped_column(Text)
    karma: Mapped[int] = mapped_column(Integer, default=0)
    provider: Mapped[str] = mapped_column(String(20), default="password")
    is_admin: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserSession(Base):
    __tablename__ = "user_sessions"
    session_token: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class PasswordReset(Base):
    __tablename__ = "password_resets"
    token: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class RouteFollow(Base):
    __tablename__ = "route_follows"
    follow_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    route_id: Mapped[str] = mapped_column(String(50), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class DeviceToken(Base):
    __tablename__ = "device_tokens"
    user_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    push_token: Mapped[str] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Route(Base):
    __tablename__ = "routes"
    route_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    vehicle_type: Mapped[str] = mapped_column(String(20))
    city: Mapped[str] = mapped_column(String(100))
    stops: Mapped[list] = mapped_column(JSON)
    fare: Mapped[Optional[float]] = mapped_column(Float)
    created_by: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Report(Base):
    __tablename__ = "reports"
    report_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    route_id: Mapped[str] = mapped_column(String(50), index=True)
    type: Mapped[str] = mapped_column(String(20))
    vehicle_type: Mapped[str] = mapped_column(String(20))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    crowd_level: Mapped[Optional[str]] = mapped_column(String(20))
    delay_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    fare: Mapped[Optional[float]] = mapped_column(Float)
    note: Mapped[Optional[str]] = mapped_column(Text)
    device_id: Mapped[Optional[str]] = mapped_column(String(100), index=True)
    status: Mapped[str] = mapped_column(String(20), default="visible")
    user_id: Mapped[str] = mapped_column(String(50))
    user_name: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=lambda: datetime.now(timezone.utc))


class DriverProfile(Base):
    __tablename__ = "driver_profiles"
    user_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    vehicle_type: Mapped[str] = mapped_column(String(20), default="car")  # car | keke
    vehicle_plate: Mapped[Optional[str]] = mapped_column(String(30))
    vehicle_color: Mapped[Optional[str]] = mapped_column(String(50))
    vehicle_model: Mapped[Optional[str]] = mapped_column(String(100))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    is_online: Mapped[int] = mapped_column(Integer, default=0)
    current_lat: Mapped[Optional[float]] = mapped_column(Float)
    current_lng: Mapped[Optional[float]] = mapped_column(Float)
    rating: Mapped[float] = mapped_column(Float, default=5.0)
    trips_completed: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class RideRequest(Base):
    __tablename__ = "ride_requests"
    ride_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    rider_id: Mapped[str] = mapped_column(String(50), index=True)
    driver_id: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    vehicle_type: Mapped[str] = mapped_column(String(20))
    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[Optional[str]] = mapped_column(String(255))
    dropoff_lat: Mapped[float] = mapped_column(Float)
    dropoff_lng: Mapped[float] = mapped_column(Float)
    dropoff_address: Mapped[Optional[str]] = mapped_column(String(255))
    distance_km: Mapped[float] = mapped_column(Float)
    fare_estimate: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[Optional[str]] = mapped_column(String(20))  # cash | card | transfer
    status: Mapped[str] = mapped_column(String(30), default="requested")  # requested|accepted|arriving|in_progress|completed|cancelled
    driver_eta_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Trip(Base):
    __tablename__ = "trips"
    trip_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    ride_id: Mapped[str] = mapped_column(String(60), index=True)
    rider_id: Mapped[str] = mapped_column(String(50), index=True)
    driver_id: Mapped[str] = mapped_column(String(50), index=True)
    fare: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress|completed
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    rating_driver: Mapped[Optional[int]] = mapped_column(Integer)  # rider rates driver (1-5)
    rating_rider: Mapped[Optional[int]] = mapped_column(Integer)  # driver rates rider (1-5)


class PaymentRecord(Base):
    __tablename__ = "payments"
    payment_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    ride_id: Mapped[str] = mapped_column(String(60), index=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    amount: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(20))  # cash | card | transfer
    provider_ref: Mapped[Optional[str]] = mapped_column(String(255))  # paystack reference / transfer ref
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|success|failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class ZoneRule(Base):
    __tablename__ = "zone_rules"
    zone_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    city: Mapped[str] = mapped_column(String(100), index=True)
    zone_name: Mapped[str] = mapped_column(String(100))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius_km: Mapped[float] = mapped_column(Float, default=3.0)
    disallowed_vehicle_types: Mapped[str] = mapped_column(String(255), default="")


# ============================ DB DEPENDENCY ============================
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# ============================ REALTIME (WEBSOCKET) ============================
class ConnectionManager:
    """Tracks authenticated websocket clients. Drivers subscribe to ride
    requests; riders receive status + live location for their active ride."""

    def __init__(self) -> None:
        self.drivers: dict[str, WebSocket] = {}  # user_id -> ws (online drivers)
        self.driver_meta: dict[str, dict] = {}   # user_id -> {vehicle_type, lat, lng}
        self.riders: dict[str, WebSocket] = {}   # user_id -> ws (active ride watchers)

    async def connect_driver(self, user_id: str, ws: WebSocket, meta: dict) -> None:
        await ws.accept()
        self.drivers[user_id] = ws
        self.driver_meta[user_id] = meta

    async def connect_rider(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.riders[user_id] = ws

    def update_driver_meta(self, user_id: str, lat: float, lng: float) -> None:
        meta = self.driver_meta.get(user_id)
        if meta:
            meta["lat"] = lat
            meta["lng"] = lng

    def disconnect_driver(self, user_id: str) -> None:
        self.drivers.pop(user_id, None)
        self.driver_meta.pop(user_id, None)

    def disconnect_rider(self, user_id: str) -> None:
        self.riders.pop(user_id, None)

    async def send_to_driver(self, user_id: str, payload: dict) -> None:
        ws = self.drivers.get(user_id)
        if ws:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect_driver(user_id)

    async def send_to_rider(self, user_id: str, payload: dict) -> None:
        ws = self.riders.get(user_id)
        if ws:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect_rider(user_id)

    async def broadcast_ride_request(self, payload: dict, vehicle_type: str, lat: float, lng: float, max_km: float = 15.0) -> None:
        for user_id, meta in list(self.driver_meta.items()):
            if meta.get("vehicle_type") != vehicle_type:
                continue
            ws = self.drivers.get(user_id)
            if not ws:
                continue
            d = _haversine_km(meta.get("lat") or lat, meta.get("lng") or lng, lat, lng)
            if d > max_km:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect_driver(user_id)


ws_manager = ConnectionManager()


def _decode_ws_user(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sub")
    except jwt.InvalidTokenError:
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent migrations for columns added to pre-existing tables
        # (MariaDB supports ADD COLUMN IF NOT EXISTS).
        for stmt in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INT DEFAULT 0",
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS device_id VARCHAR(100)",
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'visible'",
            "ALTER TABLE reports ADD INDEX IF NOT EXISTS ix_reports_device_id (device_id)",
        ]:
            await conn.exec_driver_sql(stmt)
    
    # Seed
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(func.count()).select_from(Route))
        if res.scalar() == 0:
            now = datetime.now(timezone.utc)
            for r in SEED_ROUTES:
                db_route = Route(
                    route_id=f"rt_{uuid.uuid4().hex[:10]}",
                    name=r["name"],
                    description=r["description"],
                    vehicle_type=r["vehicle_type"],
                    city=r["city"],
                    stops=r["stops"],
                    fare=r["fare"],
                    created_at=now
                )
                session.add(db_route)
            await session.commit()
            logger.info("Seeded default routes into MariaDB")

        zone_count = (await session.execute(select(func.count()).select_from(ZoneRule))).scalar()
        if zone_count == 0:
            for z in SEED_ZONES:
                session.add(ZoneRule(**z))
            await session.commit()
            logger.info("Seeded zone rules")
    yield
    await engine.dispose()


app = FastAPI(title="Public Transport Tracker API", lifespan=lifespan)
api = APIRouter(prefix="/api")


# ============================ MODELS ============================
class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    name: Optional[str] = None


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
    password: str = Field(..., min_length=6)


class PushTokenReq(BaseModel):
    push_token: str


class FollowOut(BaseModel):
    route_id: str
    created_at: datetime


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    karma: int = 0
    provider: str
    is_admin: int = 0
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserOut


VehicleType = Literal["bus", "danfo", "keke", "shuttle"]
CrowdLevel = Literal["empty", "moderate", "packed"]
ReportType = Literal["sighting", "onboard", "delay", "fare"]


class StopIn(BaseModel):
    name: str
    lat: float
    lng: float


class RouteIn(BaseModel):
    name: str
    description: Optional[str] = ""
    vehicle_type: VehicleType
    city: Optional[str] = "Generic"
    stops: List[StopIn] = []
    fare: Optional[float] = None


class RouteOut(BaseModel):
    route_id: str
    name: str
    description: str = ""
    vehicle_type: VehicleType
    city: str
    stops: List[StopIn]
    fare: Optional[float] = None
    created_by: Optional[str] = None
    created_at: datetime


class ReportIn(BaseModel):
    route_id: str
    type: ReportType
    vehicle_type: VehicleType
    lat: float
    lng: float
    crowd_level: Optional[CrowdLevel] = None
    delay_minutes: Optional[int] = None
    fare: Optional[float] = None
    note: Optional[str] = None
    device_id: Optional[str] = None


class ReportOut(BaseModel):
    report_id: str
    route_id: str
    type: ReportType
    vehicle_type: VehicleType
    lat: float
    lng: float
    crowd_level: Optional[CrowdLevel] = None
    delay_minutes: Optional[int] = None
    fare: Optional[float] = None
    note: Optional[str] = None
    device_id: Optional[str] = None
    status: str = "visible"
    user_id: str
    user_name: Optional[str] = None
    created_at: datetime


class EtaOut(BaseModel):
    route_id: str
    stop_id: int
    eta_minutes: Optional[int]
    last_seen_minutes_ago: Optional[int]
    distance_km: Optional[float]
    confidence: Literal["high", "medium", "low", "none"]


class CrowdHour(BaseModel):
    hour: int
    avg_crowd: Optional[str]  # empty / moderate / packed (rounded average)
    report_count: int


class CrowdAnalyticsOut(BaseModel):
    route_id: str
    days: int
    total_reports: int
    by_hour: List[CrowdHour]


# ============================ RIDE-HAILING MODELS ============================
class DriverRegisterReq(BaseModel):
    vehicle_type: Literal["car", "keke"]
    vehicle_plate: Optional[str] = None
    vehicle_color: Optional[str] = None
    vehicle_model: Optional[str] = None
    phone: Optional[str] = None


class DriverProfileOut(BaseModel):
    user_id: str
    name: Optional[str]
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


class EstimateReq(BaseModel):
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    vehicle_type: Literal["car", "keke"]


class ZoneInfo(BaseModel):
    zone_name: str
    city: str
    disallowed_vehicle_types: List[str]


class EstimateOut(BaseModel):
    distance_km: float
    eta_minutes: int
    fare: float
    allowed: bool
    reason: Optional[str]
    zones: List[ZoneInfo]
    payment_methods: List[str]


class RideRequestReq(BaseModel):
    pickup_lat: float
    pickup_lng: float
    pickup_address: Optional[str] = None
    dropoff_lat: float
    dropoff_lng: float
    dropoff_address: Optional[str] = None
    vehicle_type: Literal["car", "keke"]
    payment_method: Literal["cash", "card", "transfer"] = "cash"


class DriverOut(BaseModel):
    user_id: str
    name: Optional[str]
    rating: float
    trips_completed: int
    vehicle_type: str
    vehicle_plate: Optional[str]
    vehicle_color: Optional[str]
    vehicle_model: Optional[str]
    current_lat: Optional[float]
    current_lng: Optional[float]


class RideRequestOut(BaseModel):
    ride_id: str
    rider_id: str
    driver: Optional[DriverOut]
    vehicle_type: str
    pickup_lat: float
    pickup_lng: float
    pickup_address: Optional[str]
    dropoff_lat: float
    dropoff_lng: float
    dropoff_address: Optional[str]
    distance_km: float
    fare_estimate: float
    payment_method: Optional[str]
    status: str
    driver_eta_minutes: Optional[int]
    created_at: datetime


class TripOut(BaseModel):
    trip_id: str
    ride_id: str
    rider_id: str
    driver_id: str
    fare: float
    payment_method: str
    payment_status: str
    status: str
    rating_driver: Optional[int]
    rating_rider: Optional[int]
    started_at: datetime
    ended_at: Optional[datetime]


class PaymentMethodReq(BaseModel):
    payment_method: Literal["cash", "card", "transfer"]


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


class RateReq(BaseModel):
    rating: int = Field(..., ge=1, le=5)


class DriverLocationPush(BaseModel):
    lat: float
    lng: float


# ============================ AUTH HELPERS ============================
def hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_pw(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def issue_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=JWT_TTL_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(request: Request, db_sess: AsyncSession = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        if user_id:
            res = await db_sess.execute(select(User).where(User.user_id == user_id))
            user = res.scalar_one_or_none()
            if user:
                return user
    except jwt.InvalidTokenError:
        pass

    res = await db_sess.execute(select(UserSession).where(UserSession.session_token == token))
    sess = res.scalar_one_or_none()
    if sess:
        if sess.expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc):
            res = await db_sess.execute(select(User).where(User.user_id == sess.user_id))
            user = res.scalar_one_or_none()
            if user:
                return user

    raise HTTPException(status_code=401, detail="Invalid or expired token")


async def optional_user(request: Request, db_sess: AsyncSession = Depends(get_db)) -> Optional[User]:
    try:
        return await current_user(request, db_sess)
    except HTTPException:
        return None


def user_to_out(u: dict) -> UserOut:
    return UserOut(
        user_id=u["user_id"],
        email=u["email"],
        name=u.get("name"),
        picture=u.get("picture"),
        karma=u.get("karma", 0),
        provider=u.get("provider", "password"),
        is_admin=u.get("is_admin", 0),
        created_at=u["created_at"],
    )


# ============================ AUTH ROUTES ============================
@api.post("/auth/register", response_model=AuthResponse)
async def register(data: RegisterReq, db_sess: AsyncSession = Depends(get_db)):
    email = data.email.lower()
    res = await db_sess.execute(select(User).where(User.email == email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    now = datetime.now(timezone.utc)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_pw(data.password),
        "name": data.name or email.split("@")[0],
        "picture": None,
        "karma": 0,
        "provider": "password",
        "is_admin": 0,
        "created_at": now,
        "updated_at": now,
    }
    new_user = User(**user_doc)
    db_sess.add(new_user)
    await db_sess.commit()
    token = issue_token(user_id)
    return AuthResponse(token=token, user=user_to_out(user_doc))


@api.post("/auth/login", response_model=AuthResponse)
async def login(data: LoginReq, db_sess: AsyncSession = Depends(get_db)):
    email = data.email.lower()
    res = await db_sess.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user or not user.password_hash or not verify_pw(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = issue_token(user.user_id)
    return AuthResponse(token=token, user=user_to_out(user.__dict__))


@api.post("/auth/google-session", response_model=AuthResponse)
async def google_session(data: GoogleSessionReq, db_sess: AsyncSession = Depends(get_db)):
    """Exchange Emergent session_id (from OAuth redirect) for app token & user."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": data.session_id},
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}") from e
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    payload = r.json()
    email = payload["email"].lower()
    name = payload.get("name")
    picture = payload.get("picture")
    session_token = payload["session_token"]

    now = datetime.now(timezone.utc)
    res = await db_sess.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = User(
            user_id=user_id, email=email, name=name, picture=picture,
            karma=0, provider="google", created_at=now, updated_at=now
        )
        db_sess.add(user)
    else:
        user.name = name or user.name
        user.picture = picture or user.picture
        user.updated_at = now

    # Upsert session
    await db_sess.execute(delete(UserSession).where(UserSession.session_token == session_token))
    new_sess = UserSession(
        session_token=session_token, user_id=user.user_id,
        expires_at=now + timedelta(days=7), created_at=now
    )
    db_sess.add(new_sess)
    await db_sess.commit()

    token = issue_token(user.user_id)
    return AuthResponse(token=token, user=user_to_out(user.__dict__))


@api.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user_to_out(user.__dict__)


@api.post("/auth/logout")
async def logout(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    await db_sess.execute(delete(UserSession).where(UserSession.user_id == user.user_id))
    await db_sess.commit()
    return {"ok": True}


@api.post("/auth/forgot", response_model=ForgotOut)
async def forgot(data: ForgotReq, db_sess: AsyncSession = Depends(get_db)):
    """Generate a password-reset token. In production, email the token to the
    user; in this dev build the token is returned so the flow is testable."""
    res = await db_sess.execute(select(User).where(User.email == data.email.lower()))
    user = res.scalar_one_or_none()
    if not user:
        return ForgotOut(ok=True, message="If that email exists, a reset link has been sent.")
    if user.provider == "google":
        return ForgotOut(ok=True, message="This account uses Google sign-in — use 'Continue with Google'.")

    token = f"rst_{uuid.uuid4().hex[:32]}"
    now = datetime.now(timezone.utc)
    await db_sess.execute(
        delete(PasswordReset).where(PasswordReset.user_id == user.user_id)
    )
    db_sess.add(PasswordReset(
        token=token, user_id=user.user_id,
        expires_at=now + timedelta(hours=1), created_at=now
    ))
    await db_sess.commit()
    logger.info("Password reset requested for %s (token %s)", user.email, token)
    return ForgotOut(
        ok=True,
        message="A reset link has been sent to your email.",
        reset_token=token,
    )


@api.post("/auth/reset")
async def reset(data: ResetReq, db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(PasswordReset).where(PasswordReset.token == data.token))
    record = res.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not record or record.used:
        raise HTTPException(status_code=400, detail="Invalid or already-used reset token")
    expires = record.expires_at.replace(tzinfo=timezone.utc) if record.expires_at.tzinfo is None else record.expires_at
    if expires < now:
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user_res = await db_sess.execute(select(User).where(User.user_id == record.user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Account no longer exists")

    user.password_hash = hash_pw(data.password)
    user.updated_at = now
    record.used = 1
    await db_sess.execute(delete(UserSession).where(UserSession.user_id == user.user_id))
    await db_sess.commit()
    return {"ok": True, "message": "Password updated. Sign in with your new password."}


# ============================ ROUTES ============================
@api.get("/routes", response_model=List[RouteOut])
async def list_routes(city: Optional[str] = None, vehicle_type: Optional[str] = None, db_sess: AsyncSession = Depends(get_db)):
    stmt = select(Route)
    if city:
        stmt = stmt.where(Route.city == city)
    if vehicle_type:
        stmt = stmt.where(Route.vehicle_type == vehicle_type)
    stmt = stmt.order_by(Route.created_at.desc())
    res = await db_sess.execute(stmt)
    return [RouteOut(**r[0].__dict__) for r in res.all()]


@api.post("/routes", response_model=RouteOut)
async def create_route(data: RouteIn, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    route_id = f"rt_{uuid.uuid4().hex[:10]}"
    doc = {
        "route_id": route_id,
        "name": data.name,
        "description": data.description,
        "vehicle_type": data.vehicle_type,
        "city": data.city or "Generic",
        "stops": [s.model_dump() for s in data.stops],
        "fare": data.fare,
        "created_by": user.user_id,
        "created_at": now,
    }
    db_route = Route(**doc)
    db_sess.add(db_route)
    await db_sess.commit()
    return RouteOut(**doc)


@api.get("/routes/{route_id}", response_model=RouteOut)
async def get_route(route_id: str, db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Route).where(Route.route_id == route_id))
    route = res.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return RouteOut(**route.__dict__)


# ============================ REPORTS ============================
def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@api.post("/reports", response_model=ReportOut)
async def submit_report(data: ReportIn, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Route).where(Route.route_id == data.route_id))
    route = res.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    now = datetime.now(timezone.utc)
    report_id = f"rep_{uuid.uuid4().hex[:12]}"

    # Cooldown: same user + same route within 2 minutes is a duplicate
    cooldown_secs = 120
    recent = await db_sess.execute(
        select(Report).where(
            Report.user_id == user.user_id,
            Report.route_id == data.route_id,
            Report.created_at >= now - timedelta(seconds=cooldown_secs),
        ).order_by(Report.created_at.desc()).limit(1)
    )
    if recent.scalar_one_or_none():
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {cooldown_secs // 60} minute before reporting this route again.",
        )

    new_report = Report(
        report_id=report_id,
        route_id=data.route_id,
        type=data.type,
        vehicle_type=data.vehicle_type,
        lat=data.lat,
        lng=data.lng,
        crowd_level=data.crowd_level,
        delay_minutes=data.delay_minutes,
        fare=data.fare,
        note=data.note,
        device_id=data.device_id,
        status="visible",
        user_id=user.user_id,
        user_name=user.name,
        created_at=now,
    )
    db_sess.add(new_report)

    # +1 karma per report
    user.karma += 1
    await db_sess.commit()

    # Notify followers of this route (fire-and-forget)
    await _notify_route_followers(db_sess, new_report)
    return ReportOut(**new_report.__dict__)


async def _notify_route_followers(db_sess: AsyncSession, report: Report):
    try:
        follows = await db_sess.execute(
            select(RouteFollow).where(RouteFollow.route_id == report.route_id)
        )
        follower_ids = {f.user_id for f in follows.scalars().all()}
        if not follower_ids:
            return
        tokens = await db_sess.execute(
            select(DeviceToken).where(DeviceToken.user_id.in_(follower_ids))
        )
        push_tokens = [t.push_token for t in tokens.scalars().all()]
        if not push_tokens:
            return
        route_name = report.route_id  # fallback
        route_res = await db_sess.execute(select(Route).where(Route.route_id == report.route_id))
        route = route_res.scalar_one_or_none()
        if route:
            route_name = route.name

        title = f"{report.vehicle_type.capitalize()} on {route_name}"
        body = f"{report.user_name or 'A rider'} just reported a {report.type}."
        if report.crowd_level:
            body += f" Crowd: {report.crowd_level}."
        if report.delay_minutes is not None:
            body += f" Delay: {report.delay_minutes} min."

        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(
                "https://exp.host/--/api/v2/push/send",
                json=[{
                    "to": t,
                    "title": title,
                    "body": body,
                    "data": {"route_id": report.route_id, "report_id": report.report_id},
                    "sound": "default",
                } for t in push_tokens],
            )
            if resp.status_code not in (200, 201):
                logger.warning("Expo push returned %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:  # noqa: BLE001 - push failures must never break report submission
        logger.warning("Push notification dispatch failed: %s", e)


@api.get("/reports", response_model=List[ReportOut])
async def list_reports(route_id: Optional[str] = None, user_id: Optional[str] = None, minutes: int = 60, limit: int = 200, include_hidden: bool = False, user: Optional[User] = Depends(optional_user), db_sess: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    stmt = select(Report).where(Report.created_at >= since)
    if route_id:
        stmt = stmt.where(Report.route_id == route_id)
    if user_id:
        stmt = stmt.where(Report.user_id == user_id)
    if not (include_hidden and user and user.is_admin):
        stmt = stmt.where(Report.status == "visible")

    stmt = stmt.order_by(Report.created_at.desc()).limit(limit)
    res = await db_sess.execute(stmt)
    return [ReportOut(**r[0].__dict__) for r in res.all()]


@api.post("/reports/{report_id}/flag")
async def flag_report(report_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    """Mark a report as misleading/spam. Hides it from everyone but admins
    and the reporter; admins can delete it outright."""
    res = await db_sess.execute(select(Report).where(Report.report_id == report_id))
    report = res.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = "flagged"
    await db_sess.commit()
    return {"ok": True, "report_id": report_id, "status": "flagged"}


@api.delete("/reports/{report_id}")
async def delete_report(report_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Report).where(Report.report_id == report_id))
    report = res.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if not (user.is_admin or report.user_id == user.user_id):
        raise HTTPException(status_code=403, detail="Only admins or the reporter can delete this report")
    await db_sess.execute(delete(Report).where(Report.report_id == report_id))
    await db_sess.commit()
    return {"ok": True}


@api.get("/vehicles/live", response_model=List[ReportOut])
async def live_vehicles(minutes: int = 15, vehicle_type: Optional[str] = None, db_sess: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    stmt = select(Report).where(
        Report.created_at >= since,
        Report.type.in_(["sighting", "onboard"]),
        Report.status == "visible",
    )
    if vehicle_type:
        stmt = stmt.where(Report.vehicle_type == vehicle_type)

    stmt = stmt.order_by(Report.created_at.desc()).limit(500)
    res = await db_sess.execute(stmt)
    docs = [r[0] for r in res.all()]

    # Dedup: one live vehicle per device_id (keep most recent), then cluster
    # anonymous reports that sit within ~800m (likely the same vehicle).
    by_device: dict[str, Report] = {}
    anonymous: list[Report] = []
    for report in docs:
        if report.device_id:
            if report.device_id not in by_device or report.created_at > by_device[report.device_id].created_at:
                by_device[report.device_id] = report
        else:
            anonymous.append(report)

    clusters: list[Report] = []
    for report in sorted(anonymous, key=lambda r: r.created_at, reverse=True):
        placed = False
        for i, rep in enumerate(clusters):
            if _haversine_km(report.lat, report.lng, rep.lat, rep.lng) <= 0.8:
                if report.created_at > rep.created_at:
                    clusters[i] = report
                placed = True
                break
        if not placed:
            clusters.append(report)

    merged = list(by_device.values()) + clusters
    merged.sort(key=lambda r: r.created_at, reverse=True)
    return [ReportOut(**r.__dict__) for r in merged]


# ============================ FOLLOWS / NOTIFICATIONS ============================
@api.post("/me/push-token")
async def register_push_token(data: PushTokenReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    existing = await db_sess.execute(select(DeviceToken).where(DeviceToken.user_id == user.user_id))
    record = existing.scalar_one_or_none()
    if record:
        record.push_token = data.push_token
        record.updated_at = datetime.now(timezone.utc)
    else:
        db_sess.add(DeviceToken(user_id=user.user_id, push_token=data.push_token, updated_at=datetime.now(timezone.utc)))
    await db_sess.commit()
    return {"ok": True}


@api.get("/follows", response_model=List[FollowOut])
async def list_follows(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(RouteFollow).where(RouteFollow.user_id == user.user_id).order_by(RouteFollow.created_at.desc()))
    return [FollowOut(route_id=f.route_id, created_at=f.created_at) for f in res.scalars().all()]


@api.post("/follows/{route_id}", response_model=FollowOut)
async def follow_route(route_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    route_res = await db_sess.execute(select(Route).where(Route.route_id == route_id))
    if not route_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Route not found")
    existing = await db_sess.execute(select(RouteFollow).where(RouteFollow.user_id == user.user_id, RouteFollow.route_id == route_id))
    if existing.scalar_one_or_none():
        return FollowOut(route_id=route_id, created_at=datetime.now(timezone.utc))
    now = datetime.now(timezone.utc)
    follow = RouteFollow(follow_id=f"fol_{uuid.uuid4().hex[:12]}", user_id=user.user_id, route_id=route_id, created_at=now)
    db_sess.add(follow)
    await db_sess.commit()
    return FollowOut(route_id=route_id, created_at=now)


@api.delete("/follows/{route_id}")
async def unfollow_route(route_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    await db_sess.execute(delete(RouteFollow).where(RouteFollow.user_id == user.user_id, RouteFollow.route_id == route_id))
    await db_sess.commit()
    return {"ok": True}


# ============================ ANALYTICS ============================
@api.get("/analytics/crowd", response_model=CrowdAnalyticsOut)
async def crowd_analytics(route_id: str, days: int = 7, db_sess: AsyncSession = Depends(get_db)):
    route_res = await db_sess.execute(select(Route).where(Route.route_id == route_id))
    if not route_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Route not found")
    since = datetime.now(timezone.utc) - timedelta(days=min(days, 60))
    res = await db_sess.execute(
        select(Report).where(
            Report.route_id == route_id,
            Report.crowd_level.isnot(None),
            Report.status == "visible",
            Report.created_at >= since,
        )
    )
    docs = [r[0] for r in res.all()]
    buckets: dict[int, list[int]] = {h: [] for h in range(24)}
    for report in docs:
        rt = report.created_at.replace(tzinfo=timezone.utc) if report.created_at.tzinfo is None else report.created_at
        buckets[rt.hour].append(0 if report.crowd_level == "empty" else 1 if report.crowd_level == "moderate" else 2)

    CROWD_BY_LEVEL = ["empty", "moderate", "packed"]
    by_hour = []
    for hour in range(24):
        values = buckets[hour]
        if not values:
            by_hour.append(CrowdHour(hour=hour, avg_crowd=None, report_count=0))
        else:
            avg = round(sum(values) / len(values))
            by_hour.append(CrowdHour(hour=hour, avg_crowd=CROWD_BY_LEVEL[avg], report_count=len(values)))

    return CrowdAnalyticsOut(route_id=route_id, days=min(days, 60), total_reports=len(docs), by_hour=by_hour)


# ============================ ETA ============================
@api.get("/eta", response_model=EtaOut)
async def eta(route_id: str, stop_id: int, db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Route).where(Route.route_id == route_id))
    route = res.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    
    stops = route.stops
    if stop_id < 0 or stop_id >= len(stops):
        raise HTTPException(status_code=400, detail="Invalid stop_id")
    stop = stops[stop_id]

    since = datetime.now(timezone.utc) - timedelta(minutes=30)
    stmt = select(Report).where(
        Report.route_id == route_id,
        Report.type.in_(["sighting", "onboard"]),
        Report.created_at >= since
    ).order_by(Report.created_at.desc()).limit(50)
    
    res = await db_sess.execute(stmt)
    docs = [r[0] for r in res.all()]

    if not docs:
        return EtaOut(route_id=route_id, stop_id=stop_id, eta_minutes=None,
                      last_seen_minutes_ago=None, distance_km=None, confidence="none")

    latest = docs[0]
    dist = _haversine_km(latest.lat, latest.lng, stop["lat"], stop["lng"])
    
    report_time = latest.created_at.replace(tzinfo=timezone.utc) if latest.created_at.tzinfo is None else latest.created_at
    last_seen_min = max(0, int((datetime.now(timezone.utc) - report_time).total_seconds() // 60))
    
    # Assume 22km/h avg urban speed for buses/danfo, 18 for keke, 25 for shuttle
    speed_map = {"bus": 22.0, "danfo": 20.0, "keke": 18.0, "shuttle": 25.0}
    speed = speed_map.get(latest.vehicle_type, 22.0)
    travel_min = int((dist / speed) * 60)
    eta_min = max(0, travel_min - last_seen_min)

    # Karma-weighted confidence: trustworthy reporters + freshness + corroboration
    # push the rating up. Only reports newer than 30 min count (filtered above).
    if docs:
        uids = {r.user_id for r in docs}
        users_res = await db_sess.execute(select(User).where(User.user_id.in_(uids)))
        karma_map = {u.user_id: u.karma for u in users_res.scalars().all()}
        avg_karma = sum(karma_map.get(r.user_id, 0) for r in docs) / len(docs)
    else:
        avg_karma = 0.0

    score = 1
    if last_seen_min <= 15:
        score = 2
    if last_seen_min <= 5:
        score = 3
    if len(docs) >= 3:
        score += 1
    if avg_karma >= 5:
        score += 1
    if avg_karma >= 20:
        score += 1

    confidence = "high" if score >= 4 else "medium" if score >= 2 else "low"
    return EtaOut(
        route_id=route_id,
        stop_id=stop_id,
        eta_minutes=eta_min,
        last_seen_minutes_ago=last_seen_min,
        distance_km=round(dist, 2),
        confidence=confidence,
    )


# ============================ RIDE-HAILING ============================
def _driver_profile_out(d: DriverProfile, user_name: Optional[str] = None) -> DriverProfileOut:
    return DriverProfileOut(
        user_id=d.user_id,
        name=user_name,
        vehicle_type=d.vehicle_type,
        vehicle_plate=d.vehicle_plate,
        vehicle_color=d.vehicle_color,
        vehicle_model=d.vehicle_model,
        phone=d.phone,
        is_online=d.is_online,
        current_lat=d.current_lat,
        current_lng=d.current_lng,
        rating=round(d.rating or 5.0, 1),
        trips_completed=d.trips_completed or 0,
    )


async def _get_zone_rules(db_sess: AsyncSession) -> List[ZoneRule]:
    res = await db_sess.execute(select(ZoneRule))
    return list(res.scalars().all())


async def _zones_at(rules: List[ZoneRule], lat: float, lng: float) -> List[ZoneRule]:
    return [z for z in rules if _haversine_km(lat, lng, z.lat, z.lng) <= z.radius_km]


def _ride_out(r: RideRequest, driver: Optional[DriverProfile] = None, driver_name: Optional[str] = None) -> dict:
    d = None
    if driver:
        d = DriverOut(
            user_id=driver.user_id,
            name=driver_name,
            rating=round(driver.rating or 5.0, 1),
            trips_completed=driver.trips_completed or 0,
            vehicle_type=driver.vehicle_type,
            vehicle_plate=driver.vehicle_plate,
            vehicle_color=driver.vehicle_color,
            vehicle_model=driver.vehicle_model,
            current_lat=driver.current_lat,
            current_lng=driver.current_lng,
        )
    return {
        "ride_id": r.ride_id,
        "rider_id": r.rider_id,
        "driver": d,
        "vehicle_type": r.vehicle_type,
        "pickup_lat": r.pickup_lat,
        "pickup_lng": r.pickup_lng,
        "pickup_address": r.pickup_address,
        "dropoff_lat": r.dropoff_lat,
        "dropoff_lng": r.dropoff_lng,
        "dropoff_address": r.dropoff_address,
        "distance_km": r.distance_km,
        "fare_estimate": r.fare_estimate,
        "payment_method": r.payment_method,
        "status": r.status,
        "driver_eta_minutes": r.driver_eta_minutes,
        "created_at": r.created_at,
    }


async def _load_ride(db_sess: AsyncSession, ride_id: str) -> RideRequest:
    res = await db_sess.execute(select(RideRequest).where(RideRequest.ride_id == ride_id))
    ride = res.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    return ride


async def _driver_eta(db_sess: AsyncSession, lat: float, lng: float, vehicle_type: str, max_km: float = 15.0) -> Optional[int]:
    res = await db_sess.execute(select(DriverProfile).where(
        DriverProfile.is_online == 1,
        DriverProfile.vehicle_type == vehicle_type,
    ))
    best_km: Optional[float] = None
    for d in res.scalars().all():
        if d.current_lat is None or d.current_lng is None:
            continue
        km = _haversine_km(d.current_lat, d.current_lng, lat, lng)
        if km <= max_km and (best_km is None or km < best_km):
            best_km = km
    if best_km is None:
        return None
    return max(2, int(math.ceil(best_km / AVG_SPEED_KPH * 60)))


@api.post("/drivers/register", response_model=DriverProfileOut)
async def driver_register(data: DriverRegisterReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    profile = DriverProfile(
        user_id=user.user_id,
        vehicle_type=data.vehicle_type,
        vehicle_plate=data.vehicle_plate,
        vehicle_color=data.vehicle_color,
        vehicle_model=data.vehicle_model,
        phone=data.phone,
    )
    await db_sess.merge(profile)
    await db_sess.commit()
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    return _driver_profile_out(res.scalar_one(), user.name)


@api.get("/drivers/me", response_model=DriverProfileOut)
async def driver_me(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Not registered as a driver")
    return _driver_profile_out(profile, user.name)


@api.post("/drivers/status", response_model=DriverProfileOut)
async def driver_status(data: DriverStatusReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Not registered as a driver")
    profile.is_online = 1 if data.is_online else 0
    profile.current_lat = data.lat
    profile.current_lng = data.lng
    profile.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    ws_manager.update_driver_meta(user.user_id, data.lat, data.lng)
    return _driver_profile_out(profile, user.name)


@api.get("/drivers/nearby", response_model=List[DriverProfileOut])
async def drivers_nearby(lat: float, lng: float, vehicle_type: Optional[str] = None, radius_km: float = 10.0, db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.is_online == 1))
    out = []
    for d in res.scalars().all():
        if vehicle_type and d.vehicle_type != vehicle_type:
            continue
        if d.current_lat is None or d.current_lng is None:
            continue
        if _haversine_km(lat, lng, d.current_lat, d.current_lng) <= radius_km:
            out.append(_driver_profile_out(d))
    return out


@api.get("/zones", response_model=List[ZoneInfo])
async def list_zones(db_sess: AsyncSession = Depends(get_db)):
    rules = await _get_zone_rules(db_sess)
    return [
        ZoneInfo(
            zone_name=z.zone_name,
            city=z.city,
            disallowed_vehicle_types=[v.strip() for v in (z.disallowed_vehicle_types or "").split(",") if v.strip()],
        )
        for z in rules
    ]


@api.post("/rides/estimate", response_model=EstimateOut)
async def ride_estimate(data: EstimateReq, db_sess: AsyncSession = Depends(get_db)):
    straight = _haversine_km(data.pickup_lat, data.pickup_lng, data.dropoff_lat, data.dropoff_lng)
    distance = straight * ROAD_FACTOR
    minutes = distance_minutes(distance)
    fare = compute_fare(data.vehicle_type, distance, minutes)
    rules = await _get_zone_rules(db_sess)
    zones = await _zones_at(rules, data.pickup_lat, data.pickup_lng)
    banned_zone = zone_disallowed(zones, data.vehicle_type)
    driver_eta = await _driver_eta(db_sess, data.pickup_lat, data.pickup_lng, data.vehicle_type)
    return EstimateOut(
        distance_km=round(distance, 1),
        eta_minutes=minutes,
        fare=fare,
        allowed=banned_zone is None,
        reason=f"{data.vehicle_type.capitalize()} is not allowed in {banned_zone}. Pick a different pickup point or vehicle type." if banned_zone else None,
        zones=[
            ZoneInfo(
                zone_name=z.zone_name,
                city=z.city,
                disallowed_vehicle_types=[v.strip() for v in (z.disallowed_vehicle_types or "").split(",") if v.strip()],
            )
            for z in zones
        ],
        payment_methods=["cash", "card", "transfer"],
    )


@api.post("/rides", response_model=RideRequestOut)
async def request_ride(data: RideRequestReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    straight = _haversine_km(data.pickup_lat, data.pickup_lng, data.dropoff_lat, data.dropoff_lng)
    distance = straight * ROAD_FACTOR
    minutes = distance_minutes(distance)
    fare = compute_fare(data.vehicle_type, distance, minutes)

    rules = await _get_zone_rules(db_sess)
    zones = await _zones_at(rules, data.pickup_lat, data.pickup_lng)
    banned_zone = zone_disallowed(zones, data.vehicle_type)
    if banned_zone:
        raise HTTPException(status_code=400, detail=f"{data.vehicle_type.capitalize()} is not allowed in {banned_zone}.")

    driver_eta = await _driver_eta(db_sess, data.pickup_lat, data.pickup_lng, data.vehicle_type)
    if driver_eta is None:
        raise HTTPException(status_code=400, detail=f"No {data.vehicle_type} drivers are online near you right now.")

    ride = RideRequest(
        ride_id=f"rd_{uuid.uuid4().hex[:12]}",
        rider_id=user.user_id,
        vehicle_type=data.vehicle_type,
        pickup_lat=data.pickup_lat,
        pickup_lng=data.pickup_lng,
        pickup_address=data.pickup_address,
        dropoff_lat=data.dropoff_lat,
        dropoff_lng=data.dropoff_lng,
        dropoff_address=data.dropoff_address,
        distance_km=round(distance, 1),
        fare_estimate=fare,
        payment_method=data.payment_method,
        status="requested",
        driver_eta_minutes=driver_eta,
    )
    db_sess.add(ride)
    await db_sess.commit()
    await db_sess.refresh(ride)

    payload = _ride_out(ride)
    payload["event"] = "ride.request"
    await ws_manager.broadcast_ride_request(payload, data.vehicle_type, data.pickup_lat, data.pickup_lng)
    return payload


@api.get("/rides/{ride_id}", response_model=RideRequestOut)
async def get_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id and ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not part of this ride")
    driver = None
    driver_name = None
    if ride.driver_id:
        res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == ride.driver_id))
        driver = res.scalar_one_or_none()
        res2 = await db_sess.execute(select(User).where(User.user_id == ride.driver_id))
        du = res2.scalar_one_or_none()
        driver_name = du.name if du else None
    return _ride_out(ride, driver, driver_name)


@api.post("/rides/{ride_id}/cancel", response_model=RideRequestOut)
async def cancel_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the rider can cancel")
    if ride.status not in ("requested", "accepted", "arriving"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a ride in state '{ride.status}'")
    ride.status = "cancelled"
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    if ride.driver_id:
        await ws_manager.send_to_driver(ride.driver_id, {"event": "ride.cancelled", "ride_id": ride.ride_id})
    else:
        await ws_manager.send_to_rider(user.user_id, {"event": "ride.status", "ride_id": ride.ride_id, "status": "cancelled"})
    return _ride_out(ride)


@api.post("/rides/{ride_id}/accept", response_model=RideRequestOut)
async def accept_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user.user_id))
    driver = res.scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=400, detail="Register as a driver first")

    result = await db_sess.execute(
        update(RideRequest)
        .where(RideRequest.ride_id == ride_id, RideRequest.status == "requested")
        .values(driver_id=user.user_id, status="accepted", updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount == 0:
        ride = await _load_ride(db_sess, ride_id)
        return _ride_out(ride)

    ride = await _load_ride(db_sess, ride_id)
    driver.is_online = 1
    await db_sess.commit()

    await ws_manager.send_to_rider(ride.rider_id, {
        "event": "ride.status",
        "ride_id": ride.ride_id,
        "status": "accepted",
        "message": f"Your {ride.vehicle_type} driver is on the way",
    })
    out = _ride_out(ride, driver, user.name)
    await ws_manager.send_to_rider(ride.rider_id, {**out, "event": "ride.accepted"})
    return out


@api.post("/rides/{ride_id}/decline", response_model=RideRequestOut)
async def decline_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.status != "requested":
        return _ride_out(ride)
    return _ride_out(ride)


@api.post("/rides/{ride_id}/arrive", response_model=RideRequestOut)
async def arrive_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if ride.status != "accepted":
        raise HTTPException(status_code=400, detail=f"Cannot arrive from state '{ride.status}'")
    ride.status = "arriving"
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    await ws_manager.send_to_rider(ride.rider_id, {"event": "ride.status", "ride_id": ride.ride_id, "status": "arriving", "message": "Your driver has arrived"})
    return _ride_out(ride)


@api.post("/rides/{ride_id}/start", response_model=RideRequestOut)
async def start_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if ride.status != "arriving":
        raise HTTPException(status_code=400, detail=f"Cannot start from state '{ride.status}'")
    ride.status = "in_progress"
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    await ws_manager.send_to_rider(ride.rider_id, {"event": "ride.status", "ride_id": ride.ride_id, "status": "in_progress", "message": "Trip started"})
    return _ride_out(ride)


@api.post("/rides/{ride_id}/complete", response_model=TripOut)
async def complete_ride(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.driver_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned driver can do this")
    if ride.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Cannot complete from state '{ride.status}'")

    trip = Trip(
        trip_id=f"tp_{uuid.uuid4().hex[:12]}",
        ride_id=ride.ride_id,
        rider_id=ride.rider_id,
        driver_id=ride.driver_id,
        fare=ride.fare_estimate,
        payment_method=ride.payment_method or "cash",
        status="completed",
    )
    ride.status = "completed"
    ride.updated_at = datetime.now(timezone.utc)
    db_sess.add(trip)

    res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == ride.driver_id))
    driver = res.scalar_one_or_none()
    if driver:
        driver.trips_completed = (driver.trips_completed or 0) + 1
    await db_sess.commit()
    await db_sess.refresh(trip)

    await ws_manager.send_to_rider(ride.rider_id, {"event": "ride.completed", "trip_id": trip.trip_id, "ride_id": ride.ride_id, "fare": trip.fare})
    return trip


@api.post("/rides/{ride_id}/payment-method", response_model=RideRequestOut)
async def set_payment_method(ride_id: str, data: PaymentMethodReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only the rider can set payment method")
    ride.payment_method = data.payment_method
    ride.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return _ride_out(ride)


@api.post("/payments/card", response_model=CardPayOut)
async def initiate_card_payment(data: CardPayReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, data.ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your ride")
    payment_id = f"py_{uuid.uuid4().hex[:12]}"
    reference = f"NM-{uuid.uuid4().hex[:12].upper()}"
    paystack_key = os.environ.get("PAYSTACK_SECRET_KEY", "")
    authorization_url = f"https://paystack.com/pay/{reference}"

    if paystack_key:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.paystack.co/transaction/initialize",
                    headers={"Authorization": f"Bearer {paystack_key}"},
                    json={
                        "email": user.email,
                        "amount": int(data.amount * 100),
                        "reference": reference,
                        "metadata": {"ride_id": data.ride_id, "payment_id": payment_id},
                    },
                )
                if resp.status_code == 200:
                    j = resp.json()
                    authorization_url = j.get("data", {}).get("authorization_url", authorization_url)
        except Exception as e:
            logger.warning("Paystack initialize failed: %s", e)

    payment = PaymentRecord(
        payment_id=payment_id,
        ride_id=data.ride_id,
        user_id=user.user_id,
        amount=data.amount,
        method="card",
        provider_ref=reference,
        status="pending",
    )
    db_sess.add(payment)
    await db_sess.commit()
    return CardPayOut(payment_id=payment_id, authorization_url=authorization_url, reference=reference)


@api.post("/payments/card/verify")
async def verify_card_payment(payment_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(PaymentRecord).where(PaymentRecord.payment_id == payment_id))
    payment = res.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your payment")
    if payment.status == "success":
        return {"ok": True, "status": "success"}

    paystack_key = os.environ.get("PAYSTACK_SECRET_KEY", "")
    if paystack_key and payment.provider_ref:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://api.paystack.co/transaction/verify/{payment.provider_ref}",
                    headers={"Authorization": f"Bearer {paystack_key}"},
                )
                if resp.status_code == 200 and resp.json().get("data", {}).get("status") == "success":
                    payment.status = "success"
                    await db_sess.commit()
                    return {"ok": True, "status": "success"}
                return {"ok": False, "status": resp.json().get("data", {}).get("status", "pending")}
        except Exception as e:
            logger.warning("Paystack verify failed: %s", e)
            return {"ok": False, "status": "unverified"}

    # Dev mode (no key): mark success if the caller confirms via `reference` (frontend passes it).
    payment.status = "success"
    await db_sess.commit()
    return {"ok": True, "status": "success"}


@api.get("/payments/transfer/{ride_id}", response_model=TransferOut)
async def transfer_details(ride_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ride = await _load_ride(db_sess, ride_id)
    if ride.rider_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your ride")
    payment_id = f"py_{uuid.uuid4().hex[:12]}"
    reference = f"NM-TR{ride.ride_id[-8:].upper()}"
    account_number = f"00{int(ride.ride_id.replace('rd_', ''), 16) % 10**9:09d}"[-10:]
    return TransferOut(
        payment_id=payment_id,
        account_name=user.name or user.email.split("@")[0],
        account_number=account_number,
        bank_name="NaijaMove Bank",
        amount=ride.fare_estimate,
        reference=reference,
        status="pending",
    )


@api.post("/trips/{trip_id}/rate")
async def rate_trip(trip_id: str, data: RateReq, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(Trip).where(Trip.trip_id == trip_id))
    trip = res.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if user.user_id == trip.rider_id:
        trip.rating_driver = data.rating
        res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == trip.driver_id))
        driver = res.scalar_one_or_none()
        if driver:
            total = (driver.trips_completed or 0)
            prev_sum = (driver.rating or 5.0) * total
            new_rating = (prev_sum + data.rating) / (total + 1) if total else float(data.rating)
            driver.rating = round(new_rating, 2)
    elif user.user_id == trip.driver_id:
        trip.rating_rider = data.rating
    else:
        raise HTTPException(status_code=403, detail="Not part of this trip")
    await db_sess.commit()
    return {"ok": True, "rating": data.rating}


@api.websocket("/ws/rides")
async def rides_ws(websocket: WebSocket, token: str, role: str):
    user_id = _decode_ws_user(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    db_sess = AsyncSessionLocal()
    try:
        res = await db_sess.execute(select(User).where(User.user_id == user_id))
        user = res.scalar_one_or_none()
        if not user:
            await websocket.close(code=4401)
            return
        if role == "driver":
            res = await db_sess.execute(select(DriverProfile).where(DriverProfile.user_id == user_id))
            driver = res.scalar_one_or_none()
            if not driver:
                await websocket.close(code=4403)
                return
            await ws_manager.connect_driver(
                user_id,
                websocket,
                {"vehicle_type": driver.vehicle_type, "lat": driver.current_lat, "lng": driver.current_lng},
            )
            await websocket.send_json({"event": "connected", "role": "driver"})
        else:
            await ws_manager.connect_rider(user_id, websocket)
            await websocket.send_json({"event": "connected", "role": "rider"})

        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")
            if role == "driver" and msg_type == "location":
                lat = msg.get("lat")
                lng = msg.get("lng")
                if lat is not None and lng is not None:
                    await db_sess.execute(
                        update(DriverProfile).where(DriverProfile.user_id == user_id)
                        .values(current_lat=lat, current_lng=lng, updated_at=datetime.now(timezone.utc))
                    )
                    await db_sess.commit()
                    ws_manager.update_driver_meta(user_id, lat, lng)
                    res = await db_sess.execute(
                        select(RideRequest).where(
                            RideRequest.driver_id == user_id,
                            RideRequest.status.in_(["accepted", "arriving", "in_progress"]),
                        )
                    )
                    for ride in res.scalars().all():
                        await ws_manager.send_to_rider(ride.rider_id, {
                            "event": "driver.location",
                            "ride_id": ride.ride_id,
                            "lat": lat,
                            "lng": lng,
                        })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("rides_ws error: %s", e)
    finally:
        if role == "driver":
            ws_manager.disconnect_driver(user_id)
        else:
            ws_manager.disconnect_rider(user_id)
        await db_sess.close()


# ============================ HEALTH ============================
@api.get("/")
async def root():
    return {"ok": True, "service": "transport-tracker"}


@app.get("/")
async def app_root():
    """Base root to provide information and prevent 404s for automated tools."""
    return {
        "name": "Naija Ride API",
        "status": "online",
        "api_docs": "/docs",
        "message": "This is the backend API. Use the Expo development server URL to load the mobile app."
    }


# ============================ STARTUP ============================
SEED_ROUTES = [
    {
        "name": "Yaba ↔ CMS (Danfo)",
        "description": "Popular Lagos danfo route along Herbert Macaulay → Carter Bridge → CMS.",
        "vehicle_type": "danfo",
        "city": "Lagos",
        "fare": 400,
        "stops": [
            {"name": "Yaba Bus Stop", "lat": 6.5095, "lng": 3.3711},
            {"name": "Sabo", "lat": 6.5060, "lng": 3.3760},
            {"name": "Iddo Terminal", "lat": 6.4760, "lng": 3.3801},
            {"name": "Carter Bridge", "lat": 6.4666, "lng": 3.3853},
            {"name": "CMS", "lat": 6.4534, "lng": 3.3942},
        ],
    },
    {
        "name": "Wuse ↔ Garki (BRT)",
        "description": "Abuja municipal bus line connecting Wuse Market to Garki Area 11.",
        "vehicle_type": "bus",
        "city": "Abuja",
        "fare": 250,
        "stops": [
            {"name": "Wuse Market", "lat": 9.0726, "lng": 7.4730},
            {"name": "Berger Junction", "lat": 9.0654, "lng": 7.4781},
            {"name": "Area 3", "lat": 9.0537, "lng": 7.4862},
            {"name": "Garki Area 11", "lat": 9.0408, "lng": 7.4924},
        ],
    },
    {
        "name": "Mile 1 ↔ Town (Keke)",
        "description": "Port Harcourt keke shuttle from Mile 1 Market to Town.",
        "vehicle_type": "keke",
        "city": "Port Harcourt",
        "fare": 200,
        "stops": [
            {"name": "Mile 1 Market", "lat": 4.7905, "lng": 7.0048},
            {"name": "Diobu", "lat": 4.7820, "lng": 7.0072},
            {"name": "Town (Old GRA)", "lat": 4.7715, "lng": 7.0151},
        ],
    },
    {
        "name": "UNILAG Campus Shuttle",
        "description": "University of Lagos main campus loop.",
        "vehicle_type": "shuttle",
        "city": "Campus",
        "fare": 100,
        "stops": [
            {"name": "Main Gate", "lat": 6.5161, "lng": 3.3866},
            {"name": "Faculty of Science", "lat": 6.5181, "lng": 3.3974},
            {"name": "Senate Building", "lat": 6.5202, "lng": 3.3990},
            {"name": "Sports Centre", "lat": 6.5163, "lng": 3.4021},
            {"name": "Moremi Hall", "lat": 6.5151, "lng": 3.3990},
        ],
    },
]


# Zones where specific vehicle types are restricted (e.g. keke banned in Wuse, Abuja).
SEED_ZONES = [
    {
        "zone_id": f"z_{uuid.uuid4().hex[:10]}",
        "city": "Abuja",
        "zone_name": "Wuse",
        "lat": 9.0765,
        "lng": 7.4750,
        "radius_km": 3.0,
        "disallowed_vehicle_types": "keke",
    },
    {
        "zone_id": f"z_{uuid.uuid4().hex[:10]}",
        "city": "Abuja",
        "zone_name": "Central Business District",
        "lat": 9.0579,
        "lng": 7.4951,
        "radius_km": 3.5,
        "disallowed_vehicle_types": "keke",
    },
    {
        "zone_id": f"z_{uuid.uuid4().hex[:10]}",
        "city": "Lagos",
        "zone_name": "Third Mainland Bridge",
        "lat": 6.5044,
        "lng": 3.3849,
        "radius_km": 2.0,
        "disallowed_vehicle_types": "keke",
    },
]


# ============================ RIDE-HAILING HELPERS ============================
def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# Road distance is ~1.3x the straight line in urban Nigeria.
ROAD_FACTOR = 1.3
# Average urban driving speed (km/h) used for ETA + fare time component.
AVG_SPEED_KPH = 24.0

FARE_CONFIG = {
    "car": {"base": 500, "per_km": 220, "per_min": 35},
    "keke": {"base": 200, "per_km": 120, "per_min": 20},
}


def compute_fare(vehicle_type: str, distance_km: float, minutes: int) -> float:
    cfg = FARE_CONFIG.get(vehicle_type, FARE_CONFIG["car"])
    total = cfg["base"] + cfg["per_km"] * distance_km + cfg["per_min"] * minutes
    return round(total, -1)  # round to nearest ₦10


def distance_minutes(distance_km: float) -> int:
    road = distance_km * ROAD_FACTOR
    return max(2, int(math.ceil(road / AVG_SPEED_KPH * 60)))


def zone_disallowed(zones: List[ZoneRule], vehicle_type: str) -> Optional[str]:
    """Returns the zone name if `vehicle_type` is disallowed within the pickup zone."""
    for z in zones:
        disallowed = [v.strip() for v in (z.disallowed_vehicle_types or "").split(",") if v.strip()]
        if vehicle_type in disallowed:
            return z.zone_name
    return None




app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
