"""SQLAlchemy engine + session. Neon-safe defaults."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _psycopg3_url(url: str) -> str:
    """SQLAlchemy defaults `postgresql://` and `postgres://` to psycopg2.
    We installed psycopg (v3). Force the right driver."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _make_engine():
    settings = get_settings()
    # Neon gotcha: their pgbouncer (transaction pooling) rejects psycopg's
    # server-side prepared statements after ~5 executions. Turn them off.
    connect_args = {"prepare_threshold": None}
    return create_engine(
        _psycopg3_url(settings.database_url),
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
        connect_args=connect_args,
        future=True,
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Yield a session, commit on success, rollback on error, always close."""
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    with session_scope() as s:
        yield s
