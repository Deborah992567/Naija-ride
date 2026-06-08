"""Public Transport Tracker - Backend
FastAPI + MongoDB. Supports email/password JWT auth and Emergent Google Auth.
Provides routes, crowdsourced vehicle reports, and ETA calculations.
"""
from fastapi import FastAPI, APIRouter, HTTPException, status, Request, Depends
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserSession(Base):
    __tablename__ = "user_sessions"
    session_token: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    user_id: Mapped[str] = mapped_column(String(50))
    user_name: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=lambda: datetime.now(timezone.utc))


# ============================ DB DEPENDENCY ============================
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
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


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    karma: int = 0
    provider: str
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


def user_to_out(u: dict) -> UserOut:
    return UserOut(
        user_id=u["user_id"],
        email=u["email"],
        name=u.get("name"),
        picture=u.get("picture"),
        karma=u.get("karma", 0),
        provider=u.get("provider", "password"),
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
        user_id=user.user_id,
        user_name=user.name,
        created_at=now,
    )
    db_sess.add(new_report)
    
    # +1 karma per report
    user.karma += 1
    await db_sess.commit()
    return ReportOut(**new_report.__dict__)


@api.get("/reports", response_model=List[ReportOut])
async def list_reports(route_id: Optional[str] = None, minutes: int = 60, limit: int = 200, db_sess: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    stmt = select(Report).where(Report.created_at >= since)
    if route_id:
        stmt = stmt.where(Report.route_id == route_id)
    
    stmt = stmt.order_by(Report.created_at.desc()).limit(limit)
    res = await db_sess.execute(stmt)
    return [ReportOut(**r[0].__dict__) for r in res.all()]


@api.get("/vehicles/live", response_model=List[ReportOut])
async def live_vehicles(minutes: int = 15, vehicle_type: Optional[str] = None, db_sess: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    stmt = select(Report).where(
        Report.created_at >= since, 
        Report.type.in_(["sighting", "onboard"])
    )
    if vehicle_type:
        stmt = stmt.where(Report.vehicle_type == vehicle_type)
    
    stmt = stmt.order_by(Report.created_at.desc()).limit(500)
    res = await db_sess.execute(stmt)
    return [ReportOut(**r[0].__dict__) for r in res.all()]


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
    confidence = "high" if last_seen_min <= 5 and len(docs) >= 3 else "medium" if last_seen_min <= 15 else "low"
    return EtaOut(
        route_id=route_id,
        stop_id=stop_id,
        eta_minutes=eta_min,
        last_seen_minutes_ago=last_seen_min,
        distance_km=round(dist, 2),
        confidence=confidence,
    )


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




app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
