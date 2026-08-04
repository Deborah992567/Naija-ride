"""Support tickets: create, thread, reply, close (customer + admin agent)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user, require_admin
from ..db import get_db
from ..models.notification import Notification
from ..models.ticket import SupportMessage, SupportTicket
from ..models.user import User

router = APIRouter(prefix="/api", tags=["tickets"])


class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=255)
    category: str = "other"
    priority: str = "normal"
    body: str = Field(min_length=1)


class TicketReply(BaseModel):
    body: str = Field(min_length=1)


def _ticket_out(t: SupportTicket, messages: list[SupportMessage] | None = None) -> dict:
    d = {c: getattr(t, c) for c in t.__dict__ if not c.startswith("_")}
    for k in ("created_at", "updated_at"):
        v = d.get(k)
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    if messages is not None:
        d["messages"] = [
            {
                **{c: getattr(m, c) for c in m.__dict__ if not c.startswith("_")},
                "created_at": m.created_at.isoformat() if hasattr(m.created_at, "isoformat") else m.created_at,
            }
            for m in messages
        ]
    return d


@router.post("/tickets")
async def create_ticket(data: TicketCreate, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    ticket = SupportTicket(
        ticket_id=f"tk_{uuid.uuid4().hex[:12]}",
        user_id=user.user_id,
        subject=data.subject,
        category=data.category,
        priority=data.priority,
    )
    db_sess.add(ticket)
    msg = SupportMessage(
        message_id=f"ms_{uuid.uuid4().hex[:12]}",
        ticket_id=ticket.ticket_id,
        user_id=user.user_id,
        body=data.body,
        is_agent=0,
    )
    db_sess.add(msg)
    await db_sess.commit()
    return _ticket_out(ticket)


@router.get("/tickets")
async def my_tickets(user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(
        select(SupportTicket).where(SupportTicket.user_id == user.user_id).order_by(SupportTicket.updated_at.desc()).limit(50)
    )
    return [_ticket_out(t) for t in res.scalars().all()]


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(SupportTicket).where(SupportTicket.ticket_id == ticket_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if t.user_id != user.user_id and user.role != "admin" and not user.is_admin:
        raise HTTPException(status_code=403, detail="Not your ticket")
    mres = await db_sess.execute(
        select(SupportMessage).where(SupportMessage.ticket_id == ticket_id).order_by(SupportMessage.created_at.asc())
    )
    return _ticket_out(t, list(mres.scalars().all()))


@router.post("/tickets/{ticket_id}/messages")
async def reply_ticket(ticket_id: str, data: TicketReply, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(SupportTicket).where(SupportTicket.ticket_id == ticket_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    is_agent = user.role == "admin" or user.is_admin == 1
    if not is_agent and t.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your ticket")
    if t.status == "closed":
        raise HTTPException(status_code=400, detail="Ticket is closed")
    msg = SupportMessage(
        message_id=f"ms_{uuid.uuid4().hex[:12]}",
        ticket_id=ticket_id,
        user_id=user.user_id,
        body=data.body,
        is_agent=1 if is_agent else 0,
    )
    db_sess.add(msg)
    t.status = "pending" if is_agent else "open"
    t.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    notify_to = t.user_id if is_agent else None
    if notify_to:
        db_sess.add(Notification(
            user_id=t.user_id,
            title="New support reply",
            body=f"Agent replied to your ticket: {t.subject}",
            category="support",
        ))
        await db_sess.commit()
    return _ticket_out(t)


@router.post("/tickets/{ticket_id}/close")
async def close_ticket(ticket_id: str, user: User = Depends(current_user), db_sess: AsyncSession = Depends(get_db)):
    res = await db_sess.execute(select(SupportTicket).where(SupportTicket.ticket_id == ticket_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if t.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your ticket")
    t.status = "closed"
    t.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return _ticket_out(t)


# ---- Admin agent endpoints ----

@router.get("/admin/tickets")
async def admin_list_tickets(status: str = "", user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    q = select(SupportTicket).order_by(SupportTicket.updated_at.desc()).limit(100)
    if status:
        q = q.where(SupportTicket.status == status)
    res = await db_sess.execute(q)
    return [_ticket_out(t) for t in res.scalars().all()]


@router.post("/admin/tickets/{ticket_id}/status")
async def admin_set_status(ticket_id: str, status: str, user: User = Depends(require_admin), db_sess: AsyncSession = Depends(get_db)):
    if status not in ("open", "pending", "resolved", "closed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db_sess.execute(select(SupportTicket).where(SupportTicket.ticket_id == ticket_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    t.status = status
    t.updated_at = datetime.now(timezone.utc)
    await db_sess.commit()
    return _ticket_out(t)
