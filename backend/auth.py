"""Auth: bcrypt password hashing + JWT in an HTTP-only cookie.

The cookie survives a page refresh (this fixes the Streamlit "logged out on
reload" pain the operator complained about). It carries only `{sub, role, exp}`
— no PII.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_session
from .models import User


# ── password hashing ────────────────────────────────────────
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


# ── JWT ─────────────────────────────────────────────────────
def issue_token(user: User) -> tuple[str, datetime]:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(hours=s.jwt_ttl_hours)
    payload = {
        "sub": str(user.id),
        "usr": user.username,
        "role": user.role,
        "exp": exp,
    }
    tok = jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)
    return tok, exp


def _decode(tok: str) -> Optional[dict]:
    s = get_settings()
    try:
        return jwt.decode(tok, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.InvalidTokenError:
        return None


# ── cookie helpers ──────────────────────────────────────────
def set_auth_cookie(response: Response, token: str, exp: datetime) -> None:
    s = get_settings()
    response.set_cookie(
        key=s.cookie_name,
        value=token,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        expires=exp,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.cookie_name, path="/")


# ── FastAPI deps ────────────────────────────────────────────
def current_user(
    sess: Session = Depends(get_session),
    ma_auth: Optional[str] = Cookie(None),
) -> User:
    """Return the logged-in user, or 401. Use as a dependency on any protected
    endpoint. Cookie name is the settings `cookie_name` (currently 'ma_auth')."""
    if not ma_auth:
        raise HTTPException(status_code=401, detail="Kirilmagan")
    data = _decode(ma_auth)
    if not data:
        raise HTTPException(status_code=401, detail="Kirish muddati tugadi")
    try:
        uid = int(data.get("sub", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Yaroqsiz token")
    user = sess.execute(select(User).where(User.id == uid)).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Foydalanuvchi topilmadi")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Faqat admin uchun")
    return user
