"""Realtime layer: WebSocket connection manager shared by all job types."""
from datetime import date, datetime
from typing import Optional

from fastapi import WebSocket
from pydantic import BaseModel

from .geo import haversine_km
from .security import decode_token


def _json_safe(value):
    """Recursively convert non-JSON values (datetime/date/pydantic models) so send_json never throws."""
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


class ConnectionManager:
    """Tracks authenticated websocket clients.

    Drivers subscribe to job requests; riders/customers receive status +
    live location for their active job.
    """

    def __init__(self) -> None:
        self.drivers: dict[str, WebSocket] = {}  # user_id -> ws (online drivers)
        self.driver_meta: dict[str, dict] = {}   # user_id -> {vehicle_type, lat, lng}
        self.riders: dict[str, WebSocket] = {}   # user_id -> ws (active job watchers)
        self.chat_clients: dict[str, WebSocket] = {}  # user_id -> ws (ride chat sessions)

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
                await ws.send_json(_json_safe(payload))
            except Exception:
                self.disconnect_driver(user_id)

    async def send_to_rider(self, user_id: str, payload: dict) -> None:
        ws = self.riders.get(user_id)
        if ws:
            try:
                await ws.send_json(_json_safe(payload))
            except Exception:
                self.disconnect_rider(user_id)

    async def send_to_chat(self, user_id: str, payload: dict) -> None:
        ws = self.chat_clients.get(user_id)
        if ws:
            try:
                await ws.send_json(_json_safe(payload))
            except Exception:
                self.chat_clients.pop(user_id, None)

    async def broadcast_ride_request(self, payload: dict, vehicle_type: str, lat: float, lng: float, max_km: float = 15.0) -> None:
        await self.broadcast_job_request(payload, lat, lng, max_km, vehicle_types={vehicle_type})

    async def broadcast_job_request(self, payload: dict, lat: float, lng: float, max_km: float = 15.0, vehicle_types: Optional[set] = None) -> None:
        """Broadcast a job request (ride/delivery/moving) to nearby online drivers.

        `vehicle_types` optionally restricts which driver fleets receive it.
        """
        for user_id, meta in list(self.driver_meta.items()):
            if vehicle_types and meta.get("vehicle_type") not in vehicle_types:
                continue
            ws = self.drivers.get(user_id)
            if not ws:
                continue
            d = haversine_km(meta.get("lat") or lat, meta.get("lng") or lng, lat, lng)
            if d > max_km:
                continue
            try:
                await ws.send_json(_json_safe(payload))
            except Exception:
                self.disconnect_driver(user_id)


ws_manager = ConnectionManager()


def decode_ws_user(token: str) -> Optional[str]:
    return decode_token(token)
