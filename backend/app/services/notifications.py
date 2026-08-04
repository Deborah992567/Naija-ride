"""Notifications: in-app rows + Expo push delivery."""
import json
import logging
import uuid
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import EXPO_PUSH_ACCESS_TOKEN
from ..models.notification import Notification
from ..models.user import DeviceToken

logger = logging.getLogger("naija-ride")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def notification_out(n: Notification) -> dict:
    data = None
    if n.data:
        try:
            data = json.loads(n.data)
        except (ValueError, TypeError):
            data = None
    return {
        "notification_id": n.notification_id,
        "title": n.title,
        "body": n.body,
        "category": n.category,
        "data": data,
        "read": n.read_at is not None,
        "created_at": n.created_at,
    }


async def notify(
    db_sess: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    category: str = "general",
    data: Optional[dict] = None,
) -> Notification:
    """Create an in-app notification and dispatch a push to the user's devices.
    Composes with the caller's transaction (no commit)."""
    n = Notification(
        notification_id=f"nt_{uuid.uuid4().hex[:12]}",
        user_id=user_id,
        title=title,
        body=body,
        category=category,
        data=json.dumps(data) if data else None,
    )
    db_sess.add(n)
    _ = await send_push(db_sess, user_id, title, body, data or {})
    return n


async def send_push(db_sess: AsyncSession, user_id: str, title: str, body: str, data: dict) -> bool:
    """Deliver a push to the user's registered device token via Expo. Never raises."""
    res = await db_sess.execute(select(DeviceToken).where(DeviceToken.user_id == user_id))
    device = res.scalar_one_or_none()
    if not device or not device.push_token:
        return False
    payload = {
        "to": device.push_token,
        "title": title,
        "body": body,
        "sound": "default",
        "data": data,
        "_displayInForeground": "true",
    }
    headers = {"Content-Type": "application/json"}
    if EXPO_PUSH_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {EXPO_PUSH_ACCESS_TOKEN}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(EXPO_PUSH_URL, headers=headers, json=[payload])
            if resp.status_code == 200 and resp.json().get("data", [{}])[0].get("status") == "ok":
                return True
            logger.warning("Expo push failed: %s", resp.text[:200])
    except Exception as e:
        logger.warning("Expo push send error: %s", e)
    return False
