#!/usr/bin/env python3
"""Create or promote a user to admin by email.

Usage (from the backend/ directory):
    python scripts/make_admin.py admin@example.com [password]

The account must already exist (registered via the app/API) unless a password
is given, in which case the user is created as admin if missing.

Works in both dev and production — it updates the DB directly, so it does not
depend on the dev-only /auth/dev/make-admin endpoint.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.core.security import hash_pw  # noqa: E402
from app.db import AsyncSessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402


async def promote(email: str, password: str | None) -> None:
    email = email.strip().lower()
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(User).where(User.email == email))
        user = res.scalar_one_or_none()
        if user is None:
            if not password:
                print(f"error: no user with email {email!r} — pass a password to create the account")
                sys.exit(1)
            user = User(
                user_id=f"u_{uuid.uuid4().hex[:10]}",
                email=email,
                name=email.split("@")[0],
                password_hash=hash_pw(password),
                is_admin=1,
                role="admin",
                status="active",
                created_at=datetime.now(timezone.utc),
            )
            session.add(user)
            print(f"created: {email} as admin (user_id={user.user_id})")
        else:
            user.is_admin = 1
            user.role = "admin"
            print(f"ok: {email} is now admin (user_id={user.user_id}, role={user.role}, is_admin={user.is_admin})")
        await session.commit()


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print(__doc__)
        sys.exit(2)
    asyncio.run(promote(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None))
