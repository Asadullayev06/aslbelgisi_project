"""Login / logout / me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
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
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class MeOut(BaseModel):
    id: int
    username: str
    role: str


@router.post("/login", response_model=MeOut)
def login(body: LoginBody, response: Response, sess: Session = Depends(get_session)):
    u = sess.execute(
        select(User).where(User.username == body.username.strip())
    ).scalar_one_or_none()
    if u is None or not u.is_active or not verify_password(body.password, u.password_hash):
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")
    tok, exp = issue_token(u)
    set_auth_cookie(response, tok, exp)
    return MeOut(id=u.id, username=u.username, role=u.role)


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeOut)
def me(u: User = Depends(current_user)):
    return MeOut(id=u.id, username=u.username, role=u.role)
