"""User admin — list / create / update password & role / delete.

All endpoints require admin. Safety guards:
  * An admin cannot delete OR deactivate their own account (would kick
    them out and could leave the system with no admin).
  * Deleting or demoting the last active admin is refused.
  * Password minimum length enforced server-side too, not just in the UI.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, desc, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import current_user, hash_password, require_admin
from ..db import get_session
from ..models import BoxPool, KmPool, LoginEvent, OpenBox, Submission, User

router = APIRouter(prefix="/api/users", tags=["users"])

MIN_PASSWORD = 4


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    created_at: str


def _to_out(u: User) -> UserOut:
    return UserOut(
        id=u.id, username=u.username, role=u.role,
        is_active=u.is_active,
        created_at=u.created_at.isoformat() if u.created_at else "",
    )


class UserCreate(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=MIN_PASSWORD)
    role:     str = Field(default="operator")


class UserPatch(BaseModel):
    password:  str | None = None
    role:      str | None = None
    is_active: bool | None = None
    username:  str | None = None


# ── helpers ─────────────────────────────────────────────────
def _active_admin_count(sess: Session, exclude_id: int | None = None) -> int:
    q = select(func.count(User.id)).where(User.role == "admin", User.is_active == True)  # noqa: E712
    if exclude_id is not None:
        q = q.where(User.id != exclude_id)
    return int(sess.execute(q).scalar_one())


# ── endpoints ───────────────────────────────────────────────
@router.get("", response_model=list[UserOut])
def list_users(sess: Session = Depends(get_session),
               _u: User = Depends(require_admin)):
    rows = list(sess.execute(select(User).order_by(User.id.asc())).scalars())
    return [_to_out(u) for u in rows]


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate,
                sess: Session = Depends(get_session),
                _u: User = Depends(require_admin)):
    role = body.role.strip().lower()
    if role not in ("admin", "operator"):
        raise HTTPException(400, "role must be admin or operator")
    name = body.username.strip()
    if not name:
        raise HTTPException(400, "username required")
    exists = sess.execute(select(User).where(User.username == name)).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(409, "bu login band")
    u = User(username=name, role=role, is_active=True,
             password_hash=hash_password(body.password))
    sess.add(u)
    try:
        sess.commit()
    except IntegrityError:
        sess.rollback()
        raise HTTPException(409, "bu login band")
    sess.refresh(u)
    return _to_out(u)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserPatch,
                sess: Session = Depends(get_session),
                actor: User = Depends(require_admin)):
    u = sess.get(User, user_id)
    if u is None:
        raise HTTPException(404, "foydalanuvchi topilmadi")

    # Guard: never let the acting admin lock themselves out.
    if actor.id == u.id:
        if body.role and body.role != u.role:
            raise HTTPException(400, "o'z rolingizni o'zgartira olmaysiz")
        if body.is_active is False:
            raise HTTPException(400, "o'zingizni faolsizlantira olmaysiz")

    # Guard: don't drop the last active admin.
    would_stop_admin = (
        (body.role is not None and body.role != "admin") or
        (body.is_active is False)
    )
    if u.role == "admin" and u.is_active and would_stop_admin:
        remaining = _active_admin_count(sess, exclude_id=u.id)
        if remaining == 0:
            raise HTTPException(400, "kamida bitta faol admin qolishi kerak")

    if body.username is not None:
        newname = body.username.strip()
        if not newname:
            raise HTTPException(400, "username bo'sh bo'lolmaydi")
        if newname != u.username:
            clash = sess.execute(select(User).where(User.username == newname)).scalar_one_or_none()
            if clash is not None:
                raise HTTPException(409, "bu login band")
            u.username = newname

    if body.role is not None:
        role = body.role.strip().lower()
        if role not in ("admin", "operator"):
            raise HTTPException(400, "role must be admin or operator")
        u.role = role

    if body.is_active is not None:
        u.is_active = bool(body.is_active)

    if body.password is not None:
        if len(body.password) < MIN_PASSWORD:
            raise HTTPException(400, f"parol kamida {MIN_PASSWORD} belgidan iborat bo'lishi kerak")
        u.password_hash = hash_password(body.password)

    try:
        sess.commit()
    except IntegrityError:
        sess.rollback()
        raise HTTPException(409, "bu login band")
    sess.refresh(u)
    return _to_out(u)


class LoginEventOut(BaseModel):
    id: int
    user_id: int | None
    username: str            # from users table if we can resolve it, else username_tried
    device_id: str
    ip: str
    user_agent: str
    success: bool
    reason: str
    created_at: str


@router.get("/login-events", response_model=list[LoginEventOut])
def login_events(
    limit: int = Query(100, ge=1, le=1000),
    only_success: bool | None = Query(None),
    sess: Session = Depends(get_session),
    _u: User = Depends(require_admin),
):
    q = (select(LoginEvent, User.username)
         .join(User, User.id == LoginEvent.user_id, isouter=True)
         .order_by(desc(LoginEvent.id))
         .limit(limit))
    if only_success is not None:
        q = q.where(LoginEvent.success == only_success)
    out: list[LoginEventOut] = []
    for (e, uname) in sess.execute(q):
        out.append(LoginEventOut(
            id=e.id, user_id=e.user_id,
            username=(uname or e.username_tried or "—"),
            device_id=e.device_id, ip=e.ip, user_agent=e.user_agent,
            success=e.success, reason=e.reason,
            created_at=e.created_at.isoformat() if e.created_at else "",
        ))
    return out


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int,
                sess: Session = Depends(get_session),
                actor: User = Depends(require_admin)):
    u = sess.get(User, user_id)
    if u is None:
        raise HTTPException(404, "foydalanuvchi topilmadi")
    if actor.id == u.id:
        raise HTTPException(400, "o'zingizni o'chira olmaysiz")
    if u.role == "admin" and u.is_active:
        remaining = _active_admin_count(sess, exclude_id=u.id)
        if remaining == 0:
            raise HTTPException(400, "kamida bitta faol admin qolishi kerak")

    # Detach the user's activity so the FK deletes don't 500.
    # Claimed (in-progress) KMs go back to the pool; already-aggregated
    # KMs, used box-pool rows and submissions just lose attribution.
    sess.execute(
        update(KmPool)
        .where(KmPool.claimed_by == u.id, KmPool.status == "claimed")
        .values(status="pending", claimed_by=None, claimed_at=None, open_box_id=None)
    )
    sess.execute(
        update(KmPool)
        .where(KmPool.claimed_by == u.id)
        .values(claimed_by=None)
    )
    sess.execute(delete(OpenBox).where(OpenBox.user_id == u.id))
    sess.execute(update(BoxPool).where(BoxPool.used_by == u.id).values(used_by=None))
    sess.execute(update(Submission).where(Submission.submitted_by == u.id).values(submitted_by=None))

    sess.delete(u)
    sess.commit()
    return None
