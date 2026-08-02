"""AI assistant endpoint (OpenAI-compatible or offline FAQ fallback)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.deps import current_user
from ..core.logging import log_event
from ..db import get_db
from ..models.user import User
from ..services.assistant import handle_message

router = APIRouter(prefix="/api", tags=["assistant"])


class AssistantReq(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


@router.post("/assistant/message")
async def assistant_message(
    data: AssistantReq,
    user: User = Depends(current_user),
    db_sess: AsyncSession = Depends(get_db),
):
    result = await handle_message(data.message, user, db_sess)
    log_event("assistant", f"reply.{result['mode']}", user_id=user.user_id)
    return result
