"""AI assistant + offline FAQ fallback.

When AI_API_KEY is configured, messages go to an OpenAI-compatible
chat-completions endpoint (retries via core.http.client_request). Otherwise a
local intent matcher answers common questions from live user data.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import AI_API_KEY, AI_BASE_URL, AI_ENABLED, AI_MODEL, AI_TIMEOUT
from ..core.http import client_request
from ..models.rides import RideRequest
from ..models.user import User
from ..models.wallet import Wallet

SYSTEM_PROMPT = (
    "You are the Naija Ride support assistant. Answer briefly and helpfully. "
    "The user is a Naija Ride customer. If you don't know, say so and point to the in-app help."
)


def _faq_reply(message: str, user: User, wallet: Wallet | None, rides: list) -> tuple[str, str]:
    """Local intent matching over live user data. Returns (reply, mode)."""
    msg = message.lower()

    if any(w in msg for w in ("wallet", "balance", "how much money", "my money")):
        if wallet is None:
            return "You don't have a wallet yet. Top up from the Wallet tab.", "faq"
        return f"Your wallet balance is NGN {wallet.balance:,.2f}.", "faq"

    if any(w in msg for w in ("ride", "trip", "where is my car", "my order")):
        if not rides:
            return "You have no recent rides. Book one from the home tab.", "faq"
        last = rides[0]
        return (
            f"Your most recent ride ({last.ride_id[:8]}...) is currently "
            f"'{last.status}'. Check the History tab for details.",
            "faq",
        )

    if any(w in msg for w in ("driver", "drive", "partner", "become")):
        return "To drive with Naija Ride: open Profile, tap 'Become a Driver' and complete verification.", "faq"

    if any(w in msg for w in ("price", "cost", "estimate", "how much")):
        return "Estimates are shown before you book. Prices depend on vehicle type and distance.", "faq"

    if any(w in msg for w in ("ref", "referral", "coupon", "code", "promo")):
        return "Share your referral code in Profile to earn bonuses. Enter promo codes at checkout.", "faq"

    if any(w in msg for w in ("help", "hi", "hello", "hey", "support", "contact")):
        return "Hi! I can help with wallet, rides, pricing, driving, and promo codes. What do you need?", "faq"

    return (
        "I'm in offline mode and only know common answers (wallet, rides, pricing, driving, promos). "
        "For anything else, open Support in the app.",
        "faq",
    )


async def _ai_reply(message: str, user: User, db_sess: AsyncSession) -> str:
    data = {"messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": message}]}
    resp = await client_request(
        "post",
        f"{AI_BASE_URL}/chat/completions",
        json={**data, "model": AI_MODEL, "max_tokens": 300},
        headers={"Authorization": f"Bearer {AI_API_KEY}"},
        timeout=AI_TIMEOUT,
        retries=2,
    )
    if resp.status_code != 200:
        return "I'm having trouble reaching my brain right now. Please try again shortly."
    try:
        payload = resp.json()
    except ValueError:
        return "Sorry, I didn't get that."
    choices = payload.get("choices") or []
    return choices[0]["message"]["content"].strip() if choices else "Sorry, I didn't get that."


async def handle_message(message: str, user: User, db_sess: AsyncSession) -> dict:
    wallet = (
        await db_sess.execute(select(Wallet).where(Wallet.user_id == user.user_id))
    ).scalar_one_or_none()
    rides = list(
        (
            await db_sess.execute(
                select(RideRequest)
                .where(RideRequest.rider_id == user.user_id)
                .order_by(RideRequest.created_at.desc())
                .limit(3)
            )
        ).scalars().all()
    )

    if AI_ENABLED and AI_API_KEY:
        try:
            reply = await _ai_reply(message, user, db_sess)
            return {"reply": reply, "mode": "ai"}
        except Exception:
            pass  # fall through to offline FAQ on any failure

    reply, mode = _faq_reply(message, user, wallet, rides)
    return {"reply": reply, "mode": mode}
