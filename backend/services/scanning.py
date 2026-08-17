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

from sqlalchemy import and_, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Box, BoxPool, KmPool, OpenBox, Project, ScanEvent, User
from .codes import canonical_km, classify_scan, normalize_sscc

# Bound the work in one transaction. The client sends whatever has piled up in
# its queue; anything past this is simply handled by the next request.
MAX_BATCH = 200


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
    KM claim in _claim_km_run are one atomic step — two guns firing into the same
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
    """Single-code scan. Thin wrapper over scan_batch so there is exactly one
    implementation of the accept/reject rules — two copies would drift."""
    return scan_batch(sess, project_id, user_id, [raw], attempt=attempt)[0]


def _scan_sscc(sess: Session, project_id: int, user_id: int, sscc: str) -> dict:
    """Close the operator's open box using this SSCC. Serialized on project row."""
    project = sess.execute(
        select(Project).where(Project.id == project_id).with_for_update()
    ).scalar_one_or_none()
    if not project or project.status != "active":
        return _err("loyiha faol emas")

    # Lock order is always projects → open_boxes (see scan_batch), so a KM scan
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

    # Commit the box. SAVEPOINT, not a plain try/except: this runs inside a
    # batch, and a bare sess.rollback() here would throw away every KM claimed
    # earlier in the same request.
    try:
        with sess.begin_nested():
            box = Box(
                project_id=project_id, sscc=sscc, capacity=cap,
                is_loose=ob.is_loose, closed_by=user_id,
            )
            sess.add(box)
            sess.flush()
    except IntegrityError:
        # Race for the loose slot: ux_boxes_one_loose caught it.
        return _err("loose quti allaqachon yopilgan")

    sess.execute(
        update(KmPool)
        .where(KmPool.open_box_id == ob.id)
        .values(status="aggregated", box_id=box.id, open_box_id=None)
    )
    sess.delete(ob)
    # Make the delete visible now — a batch may open a fresh box straight after
    # this, and an unflushed delete would hand back the stale row.
    sess.flush()

    tag = "LOOSE " if box.is_loose else ""
    return _hit(f"{tag}quti yopildi - {sscc}  ·  {n} ta kod",
                closed_box_id=box.id, sscc=sscc, is_loose=box.is_loose,
                codes_in_box=n, kind="sscc")


# ═════════════════════════════════════════════════════════════
# Batched scanning
# ═════════════════════════════════════════════════════════════
# Why this exists: a round-trip to Neon costs ~80ms, and the per-code path
# needed roughly eight of them, so one barcode took over half a second and a
# fast operator outran the system badly. A whole burst now travels in one
# request and resolves in ~4 statements regardless of how many codes it holds.

def _record_events(sess: Session, project_id: int, user_id: int,
                   rows: list[tuple[str, str, str, str]]) -> None:
    """Bulk-append to the audit log: (raw, km, level, reason)."""
    if not rows:
        return
    sess.execute(
        insert(ScanEvent),
        [{"project_id": project_id, "user_id": user_id, "raw_code": raw[:400],
          "km_code": km[:400], "level": level, "reason": reason[:500]}
         for (raw, km, level, reason) in rows],
    )


def _claim_km_run(sess: Session, project: Project, user_id: int, ob: OpenBox,
                  run: list[tuple[int, str, str]], results: list[Optional[dict]],
                  attempt: int) -> None:
    """Claim a consecutive run of KM codes for one open box.

    `run` is [(result_index, raw, canonical_km)] in scan order. Fills
    `results` in place. Costs one UPDATE plus, only if something failed, one
    diagnostic SELECT — instead of two statements per code.
    """
    cap   = _effective_capacity(project, ob)
    count = _open_box_count(sess, ob.id)

    # In-burst duplicates: the same code twice in one batch is a double scan,
    # and only the first can be claimed.
    seen: set[str] = set()
    todo: list[tuple[int, str, str]] = []
    for idx, raw, km in run:
        if km in seen:
            results[idx] = _err(f"joriy qutingizda takroriy: {km}", kind="km", code=km)
        else:
            seen.add(km)
            todo.append((idx, raw, km))

    failed: list[tuple[int, str, str]] = []
    pos = 0
    while pos < len(todo):
        room = cap - count
        if room <= 0:
            break
        chunk = todo[pos:pos + room]
        claimed = {c for (c,) in sess.execute(
            update(KmPool)
            .where(KmPool.project_id == project.id,
                   KmPool.km_code.in_([km for (_, _, km) in chunk]),
                   KmPool.status == "pending")
            .values(status="claimed", claimed_by=user_id,
                    claimed_at=datetime.now(timezone.utc), open_box_id=ob.id)
            .returning(KmPool.km_code)
        )}
        # Report in scan order so the running count reads correctly.
        for idx, raw, km in chunk:
            if km in claimed:
                count += 1
                results[idx] = _hit(f"qabul qilindi ({count}/{cap})  ·  {km}",
                                    current=count, capacity=cap, kind="km", code=km)
            else:
                failed.append((idx, raw, km))
        pos += len(chunk)
        if not claimed:
            break        # nothing in this chunk was claimable; stop retrying

    # Codes we never got room for. They still go through diagnosis below: a
    # code that is already sitting in this box is a duplicate (or a retry of
    # one that landed), and calling that "box full" would send the operator
    # off to rescan something the system already has.
    failed.extend(todo[pos:])

    if not failed:
        return

    # One diagnostic query explains every failure in the run.
    info = {km: (status, claimed_by, open_box_id, uname, sscc) for
            (km, status, claimed_by, open_box_id, uname, sscc) in sess.execute(
        select(KmPool.km_code, KmPool.status, KmPool.claimed_by,
               KmPool.open_box_id, User.username, Box.sscc)
        .select_from(KmPool)
        .join(User, User.id == KmPool.claimed_by, isouter=True)
        .join(Box,  Box.id  == KmPool.box_id,     isouter=True)
        .where(KmPool.project_id == project.id,
               KmPool.km_code.in_([km for (_, _, km) in failed]))
    )}
    for idx, raw, km in failed:
        row = info.get(km)
        if row is None:
            results[idx] = _err(f"ro'yxatda yo'q kod: {km}", kind="km", code=km)
            continue
        status, claimed_by, open_box_id, uname, sscc = row
        if status == "pending":
            # Only reachable when the box had no room left for it.
            results[idx] = _err(
                f"quti to'ldi ({count}/{cap}). Quti barkodini skanerlang.",
                box_full=True, current=count, capacity=cap, kind="km", code=km)
        elif status == "aggregated":
            tail = f" ({sscc})" if sscc else ""
            results[idx] = _err(f"boshqa qutida ishlatilgan{tail}: {km}",
                                kind="km", code=km)
        elif claimed_by == user_id:
            if attempt > 1 and open_box_id == ob.id:
                # Our own earlier delivery did land; the reply was lost.
                results[idx] = _hit(f"qabul qilindi ({count}/{cap})  ·  {km}",
                                    current=count, capacity=cap,
                                    kind="km", code=km, deduped=True)
            else:
                results[idx] = _err(f"joriy qutingizda takroriy: {km}",
                                    kind="km", code=km)
        else:
            who = uname or f"user#{claimed_by}"
            results[idx] = _err(f"⚠ {who} hozir skanerladi: {km}", kind="km", code=km)


def scan_batch(sess: Session, project_id: int, user_id: int,
               raws: list[str], attempt: int = 1) -> list[dict]:
    """Process a burst of scans in order, in one transaction.

    Order is preserved exactly as the operator scanned, so a box-closing SSCC
    still applies to the KMs that came before it and not to the ones after.
    """
    raws = raws[:MAX_BATCH]
    results: list[Optional[dict]] = [None] * len(raws)

    project = sess.get(Project, project_id)
    if not project or project.status != "active":
        out = [_err("loyiha faol emas") for _ in raws]
        _record_events(sess, project_id, user_id,
                       [(r, "", "err", "loyiha faol emas") for r in raws])
        return out

    # Classify everything up front, then walk it as runs of KM separated by
    # SSCCs. Each run is claimed in bulk; each SSCC closes the box.
    parsed: list[tuple[int, str, str, str]] = []      # (idx, kind, raw, code)
    for i, raw in enumerate(raws):
        kind = classify_scan(raw)
        if kind == "km":
            parsed.append((i, "km", raw, canonical_km(raw)))
        elif kind == "sscc":
            try:
                parsed.append((i, "sscc", raw, normalize_sscc(raw)))
            except ValueError as e:
                results[i] = _err(str(e))
        else:
            results[i] = _err(f"tanib bo'lmadigan skaner: {raw[:40]}")

    ob = _get_or_create_open_box(sess, project_id, user_id, lock=True)

    run: list[tuple[int, str, str]] = []
    for idx, kind, raw, code in parsed:
        if kind == "km":
            run.append((idx, raw, code))
            continue
        if run:
            _claim_km_run(sess, project, user_id, ob, run, results, attempt)
            run = []
        results[idx] = _scan_sscc(sess, project_id, user_id, code)
        # The box was consumed (or the close failed); either way re-resolve it
        # before any further KMs are claimed.
        ob = _get_or_create_open_box(sess, project_id, user_id, lock=True)
    if run:
        _claim_km_run(sess, project, user_id, ob, run, results, attempt)

    final = [r if r is not None else _err("qayta ishlanmadi") for r in results]
    _record_events(sess, project_id, user_id, [
        (raws[i], (res.get("code") or ""), res["level"], res["message"])
        for i, res in enumerate(final)
    ])
    return final


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
