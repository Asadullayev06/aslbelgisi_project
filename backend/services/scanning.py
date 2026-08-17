"""Scanning operations — atomic SQL, shape matches plan.md §4.

Every operation is safe under concurrent operators because the DB does the
work. For v1 there is only one user, but keeping the shape means the
multi-user upgrade is just wiring, not re-architecting.

All return values are dicts with:
    {"level": "hit" | "err" | "warn", "message": <uzbek str>, ...extras}
API layer forwards them as-is.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Box, BoxPool, KmPool, OpenBox, Project, User
from .codes import canonical_km, classify_scan, normalize_sscc


# ── result helpers ──────────────────────────────────────────
def _hit(msg: str, **extra) -> dict:  return {"level": "hit",  "message": msg, **extra}
def _err(msg: str, **extra) -> dict:  return {"level": "err",  "message": msg, **extra}
def _warn(msg: str, **extra) -> dict: return {"level": "warn", "message": msg, **extra}


# ── open-box helpers ────────────────────────────────────────
def _get_or_create_open_box(sess: Session, project_id: int, user_id: int,
                            lock: bool = False) -> OpenBox:
    """Get the operator's open box, creating it atomically if absent.

    RACE THIS FIXES: the old read-then-INSERT lost scans. Right after a box
    closed (the open_boxes row is deleted) two fast scans would both find
    nothing and both INSERT, one hit uq_open_boxes_project_user, the request
    500'd, and that barcode was silently gone. ON CONFLICT DO NOTHING makes
    the create idempotent.

    With `lock=True` the row is taken FOR UPDATE so the capacity check and the
    KM claim in _scan_km are one atomic step — two guns firing into the same
    box can no longer both read the same count.
    """
    sess.execute(
        pg_insert(OpenBox)
        .values(project_id=project_id, user_id=user_id, is_loose=False)
        .on_conflict_do_nothing(index_elements=["project_id", "user_id"])
    )
    q = (select(OpenBox)
         .where(OpenBox.project_id == project_id, OpenBox.user_id == user_id)
         .execution_options(populate_existing=True))   # never trust the identity map
    if lock:
        q = q.with_for_update()
    ob = sess.execute(q).scalar_one_or_none()
    if ob is None:
        # Concurrent delete between our insert and select — try once more.
        sess.execute(
            pg_insert(OpenBox)
            .values(project_id=project_id, user_id=user_id, is_loose=False)
            .on_conflict_do_nothing(index_elements=["project_id", "user_id"])
        )
        ob = sess.execute(q).scalar_one()
    return ob


def _open_box_count(sess: Session, open_box_id: int) -> int:
    return int(sess.execute(
        select(func.count(KmPool.id)).where(KmPool.open_box_id == open_box_id)
    ).scalar_one())


def _effective_capacity(project: Project, open_box: OpenBox) -> int:
    return project.loose_qty if open_box.is_loose else project.per_box


def _plan_full_boxes(project: Project) -> int:
    return project.total_boxes - (1 if project.has_loose else 0)


# ═════════════════════════════════════════════════════════════
# KM scan
# ═════════════════════════════════════════════════════════════
def scan_code(sess: Session, project_id: int, user_id: int, raw: str,
              attempt: int = 1) -> dict:
    """Route a raw scanner input to the right handler.

    We accept any code and dispatch based on shape (KM vs SSCC), so the
    operator only needs one input field.

    `attempt` > 1 means the client is re-sending after a network failure. The
    first try may well have committed before the connection dropped, so a code
    already sitting in this operator's own open box counts as success instead
    of a duplicate error — that makes client-side retries safe.
    """
    kind = classify_scan(raw)
    if kind == "unknown":
        return _err(f"tanib bo'lmadigan skaner: {raw[:40]}")
    if kind == "km":
        return _scan_km(sess, project_id, user_id, canonical_km(raw), attempt)
    return _scan_sscc(sess, project_id, user_id, normalize_sscc(raw))


def _scan_km(sess: Session, project_id: int, user_id: int, km: str,
             attempt: int = 1) -> dict:
    project = sess.get(Project, project_id)
    if not project or project.status != "active":
        return _err("loyiha faol emas")

    # FOR UPDATE: serialize this operator's own scans so the capacity check
    # below and the claim underneath it cannot interleave.
    ob = _get_or_create_open_box(sess, project_id, user_id, lock=True)
    cap = _effective_capacity(project, ob)
    now_count = _open_box_count(sess, ob.id)

    if now_count >= cap:
        return _err(f"quti to'ldi ({now_count}/{cap}). Quti barkodini skanerlang.",
                    box_full=True, current=now_count, capacity=cap)

    # Atomic claim. plan.md §4.1
    updated = sess.execute(
        update(KmPool)
        .where(
            KmPool.project_id == project_id,
            KmPool.km_code    == km,
            KmPool.status     == "pending",
        )
        .values(status="claimed", claimed_by=user_id,
                claimed_at=datetime.now(timezone.utc),
                open_box_id=ob.id)
        .returning(KmPool.id)
    ).scalar_one_or_none()

    if updated is not None:
        new_count = now_count + 1
        return _hit(f"qabul qilindi ({new_count}/{cap})  ·  {km}",
                    current=new_count, capacity=cap, kind="km", code=km)

    # Zero rows — figure out why (name WHICH operator got it, plan.md §4.1).
    row = sess.execute(
        select(KmPool.status, KmPool.claimed_by, KmPool.open_box_id,
               User.username, Box.sscc)
        .select_from(KmPool)
        .join(User, User.id == KmPool.claimed_by, isouter=True)
        .join(Box,  Box.id  == KmPool.box_id,     isouter=True)
        .where(KmPool.project_id == project_id, KmPool.km_code == km)
    ).one_or_none()
    if row is None:
        return _err(f"ro'yxatda yo'q kod: {km}")
    status, claimed_by, open_box_id, other_name, box_sscc = row
    if status == "aggregated":
        tail = f" ({box_sscc})" if box_sscc else ""
        return _err(f"boshqa qutida ishlatilgan{tail}: {km}")
    # status == 'claimed'
    if claimed_by == user_id:
        if attempt > 1 and open_box_id == ob.id:
            # Our own earlier attempt did land; the reply just never made it
            # back. Report success so the retry is a no-op, not a false error.
            return _hit(f"qabul qilindi ({now_count}/{cap})  ·  {km}",
                        current=now_count, capacity=cap, kind="km", code=km,
                        deduped=True)
        return _err(f"joriy qutingizda takroriy: {km}")
    who = other_name or f"user#{claimed_by}"
    return _err(f"⚠ {who} hozir skanerladi: {km}")


def _scan_sscc(sess: Session, project_id: int, user_id: int, sscc: str) -> dict:
    """Close the operator's open box using this SSCC. Serialized on project row."""
    project = sess.execute(
        select(Project).where(Project.id == project_id).with_for_update()
    ).scalar_one_or_none()
    if not project or project.status != "active":
        return _err("loyiha faol emas")

    # Lock order is always projects → open_boxes (see _scan_km), so a KM scan
    # and a box-close racing each other can't deadlock.
    ob = sess.execute(
        select(OpenBox)
        .where(OpenBox.project_id == project_id, OpenBox.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if ob is None:
        return _err("quti bo'sh - avval KM larni skanerlang")

    n = _open_box_count(sess, ob.id)
    if n == 0:
        return _err("quti bo'sh - avval KM larni skanerlang")

    cap = _effective_capacity(project, ob)
    if n < cap:
        return _err(f"quti hali to'lmagan ({n}/{cap}). KM skanerlashda davom eting.")

    # Claim SSCC atomically.
    got = sess.execute(
        update(BoxPool)
        .where(BoxPool.project_id == project_id,
               BoxPool.sscc == sscc,
               BoxPool.status == "pending")
        .values(status="used", used_by=user_id,
                used_at=datetime.now(timezone.utc))
        .returning(BoxPool.id)
    ).scalar_one_or_none()

    if got is None:
        exists = sess.execute(
            select(BoxPool.status).where(BoxPool.project_id == project_id,
                                         BoxPool.sscc == sscc)
        ).scalar_one_or_none()
        if exists is None:
            return _err(f"quti kodi ro'yxatda yo'q: {sscc}. "
                        "Uni Sozlash bosqichida yuklang.")
        return _err(f"bu quti kodi allaqachon ishlatilgan: {sscc}")

    # Plan-limit checks — held by FOR UPDATE on project.
    full_closed = int(sess.execute(
        select(func.count(Box.id)).where(Box.project_id == project_id,
                                         Box.is_loose == False)  # noqa: E712
    ).scalar_one())
    loose_closed = int(sess.execute(
        select(func.count(Box.id)).where(Box.project_id == project_id,
                                         Box.is_loose == True)   # noqa: E712
    ).scalar_one())

    if ob.is_loose and loose_closed >= 1:
        return _err("loose quti allaqachon yopilgan")
    if (not ob.is_loose) and full_closed >= _plan_full_boxes(project):
        return _err(f"rejadagi to'liq qutilar soni ({_plan_full_boxes(project)}) "
                    "to'ldi - loose rejimga o'ting yoki finalize qiling")

    # Commit the box.
    try:
        box = Box(
            project_id=project_id, sscc=sscc, capacity=cap,
            is_loose=ob.is_loose, closed_by=user_id,
        )
        sess.add(box)
        sess.flush()
    except IntegrityError:
        # Race for the loose slot: ux_boxes_one_loose caught it.
        sess.rollback()
        return _err("loose quti allaqachon yopilgan")

    sess.execute(
        update(KmPool)
        .where(KmPool.open_box_id == ob.id)
        .values(status="aggregated", box_id=box.id, open_box_id=None)
    )
    sess.delete(ob)

    tag = "LOOSE " if box.is_loose else ""
    return _hit(f"{tag}quti yopildi - {sscc}  ·  {n} ta kod",
                closed_box_id=box.id, sscc=sscc, is_loose=box.is_loose,
                codes_in_box=n, kind="sscc")


# ═════════════════════════════════════════════════════════════
# undo / discard / loose toggle / delete box
# ═════════════════════════════════════════════════════════════
def undo_last(sess: Session, project_id: int, user_id: int) -> dict:
    ob = sess.execute(
        select(OpenBox).where(OpenBox.project_id == project_id,
                              OpenBox.user_id == user_id)
    ).scalar_one_or_none()
    if ob is None:
        return _err("joriy quti bo'sh")

    last = sess.execute(
        select(KmPool).where(KmPool.open_box_id == ob.id, KmPool.status == "claimed")
        .order_by(KmPool.claimed_at.desc(), KmPool.id.desc()).limit(1)
    ).scalar_one_or_none()
    if last is None:
        return _err("o'chirish uchun kod yo'q")

    last.status = "pending"
    last.claimed_by = None
    last.claimed_at = None
    last.open_box_id = None
    return _hit(f"o'chirildi: {last.km_code}")


def discard_open(sess: Session, project_id: int, user_id: int) -> dict:
    ob = sess.execute(
        select(OpenBox).where(OpenBox.project_id == project_id,
                              OpenBox.user_id == user_id)
    ).scalar_one_or_none()
    if ob is None:
        return _hit("joriy quti bo'sh")

    sess.execute(
        update(KmPool)
        .where(KmPool.open_box_id == ob.id, KmPool.status == "claimed")
        .values(status="pending", claimed_by=None, claimed_at=None, open_box_id=None)
    )
    sess.delete(ob)
    return _hit("joriy quti tozalandi, kodlar ro'yxatga qaytdi")


def set_loose_mode(sess: Session, project_id: int, user_id: int, on: bool) -> dict:
    project = sess.get(Project, project_id)
    if project is None or not project.has_loose:
        return _err("bu loyihada loose paket yo'q")

    loose_already = sess.execute(
        select(func.count(Box.id)).where(Box.project_id == project_id,
                                         Box.is_loose == True)   # noqa: E712
    ).scalar_one()
    if on and loose_already:
        return _err("loose quti allaqachon yopilgan")

    ob = _get_or_create_open_box(sess, project_id, user_id, lock=True)
    if _open_box_count(sess, ob.id) > 0:
        return _err("avval joriy qutini yoping yoki tozalang")
    ob.is_loose = bool(on)
    return _hit(f"loose rejim {'yoqildi' if on else 'o' + chr(0x027B) + 'chirildi'}")


def delete_box(sess: Session, project_id: int, box_id: int) -> dict:
    box = sess.get(Box, box_id)
    if box is None or box.project_id != project_id:
        return _err("quti topilmadi")

    # KMs of that box → back to pending
    sess.execute(
        update(KmPool)
        .where(KmPool.box_id == box_id)
        .values(status="pending", box_id=None, claimed_by=None,
                claimed_at=None, open_box_id=None)
    )
    # SSCC → pending
    sess.execute(
        update(BoxPool)
        .where(BoxPool.project_id == project_id, BoxPool.sscc == box.sscc)
        .values(status="pending", used_by=None, used_at=None)
    )
    sess.delete(box)
    return _hit(f"quti bekor qilindi ({box.sscc})")
