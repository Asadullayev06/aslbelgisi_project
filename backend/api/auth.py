"""Login / logout / me + login-event audit."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    clear_auth_cookie,
    current_user,
    issue_token,
    set_auth_cookie,
    verify_password,
)
from ..db import get_session
from ..models import LoginEvent, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str
    device_id: str | None = None      # random UUID from client localStorage


class MeOut(BaseModel):
    id: int
    username: str
    role: str


def _client_ip(request: Request) -> str:
    """Prefer the proxy-set XFF (Railway routes through one) so we log the
    actual client address, not the internal edge IP."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def _record(sess: Session, *, request: Request, body: LoginBody,
            user_id: int | None, success: bool, reason: str) -> None:
    sess.add(LoginEvent(
        user_id=user_id,
        username_tried=(body.username or "")[:128],
        device_id=(body.device_id or "")[:64],
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:400],
        success=success,
        reason=reason,
    ))
    sess.commit()


@router.post("/login", response_model=MeOut)
def login(body: LoginBody, response: Response, request: Request,
          sess: Session = Depends(get_session)):
    u = sess.execute(
        select(User).where(User.username == body.username.strip())
    ).scalar_one_or_none()

    if u is None:
        _record(sess, request=request, body=body, user_id=None,
                success=False, reason="unknown_user")
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")
    if not u.is_active:
        _record(sess, request=request, body=body, user_id=u.id,
                success=False, reason="user_disabled")
        raise HTTPException(status_code=401, detail="Foydalanuvchi faol emas")
    if not verify_password(body.password, u.password_hash):
        _record(sess, request=request, body=body, user_id=u.id,
                success=False, reason="bad_password")
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")

    tok, exp = issue_token(u)
    set_auth_cookie(response, tok, exp)
    _record(sess, request=request, body=body, user_id=u.id,
            success=True, reason="ok")
    return MeOut(id=u.id, username=u.username, role=u.role)


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeOut)
def me(u: User = Depends(current_user)):
    return MeOut(id=u.id, username=u.username, role=u.role)
