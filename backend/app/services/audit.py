"""Admin/system audit logging."""
import json
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit import AuditLog


async def log_audit(
    db_sess: AsyncSession,
    actor_id: Optional[str],
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    meta: Optional[dict] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Append an audit row (committed with the caller's transaction)."""
    db_sess.add(
        AuditLog(
            audit_id=f"au_{uuid.uuid4().hex[:12]}",
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=json.dumps(meta) if meta else None,
            ip_address=ip_address,
        )
    )
