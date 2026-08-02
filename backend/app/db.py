"""Async SQLAlchemy engine + session factory for the whole app."""
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import (
    DB_ECHO,
    DB_MAX_OVERFLOW,
    DB_POOL_RECYCLE,
    DB_POOL_SIZE,
    DB_URL,
)


class Base(DeclarativeBase):
    pass


# Pool sizing lets the app serve concurrent riders/drivers without opening a
# new connection per request; pool_pre_ping drops stale connections, and
# pool_recycle rotates them so long-lived proxies don't kill the connection.
engine = create_async_engine(
    DB_URL,
    echo=DB_ECHO,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_recycle=DB_POOL_RECYCLE,
    pool_pre_ping=True,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    """FastAPI dependency yielding an async session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
