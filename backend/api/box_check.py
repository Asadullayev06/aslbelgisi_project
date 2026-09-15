"""Box-check module — audit a physical box against ASL Belgisi's records.

Flow, all through one router:
  1. POST /api/box-check/scan-box  — scan an SSCC. Server calls ASL 9.3
     owner-check for (INN, api_key), verifies the box belongs to that INN,
     and pulls the child KMs. Creates a `box_checks` row, returns its id +
     the expected KM list.
  2. POST /api/box-check/{id}/scan — scan a KM (or a batch). Every code is
     compared against the expected set: match / duplicate / extra. Persists
     one `box_check_scans` row per scan.
  3. POST /api/box-check/{id}/close — freeze the audit. Status = closed_ok
     if matched == expected and no extras, closed_mismatch otherwise.
  4. GET  /api/box-check                          — recent audits (mine).
  5. GET  /api/box-check/{id}                     — full state + scan list.
  6. DELETE /api/box-check/{id}                   — admin discard.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import BoxCheck, BoxCheckScan, User
from ..services.asl_stock import fetch_box_children, verify_api_key_ownership
from ..services.codes import canonical_km, classify_scan, normalize_sscc

router = APIRouter(prefix="/api/box-check", tags=["box-check"])


# ─────────────────────────── schemas ────────────────────────────
class ScanBoxIn(BaseModel):
    inn: str = Field(min_length=1)
    api_key: str = Field(min_length=1)
    sscc: str = Field(min_length=1)
    company_name: str = ""


class ScanKmIn(BaseModel):
    codes: list[str] = Field(min_length=1)


class BoxScanRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    verdict: str
    scanned_at: datetime


class BoxCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_name: str
    owner_inn: str
    sscc: str
    expected_count: int
    product_name: str
    gtin: str
    package_type: str
    status: str
    opened_at: datetime
    closed_at: datetime | None = None


class BoxCheckState(BaseModel):
    box: BoxCheckOut
    expected_kms: list[str]
    matched: list[str]
    extras: list[str]
    missing: list[str]
    matched_count: int
    extra_count: int
    missing_count: int
    scans: list[BoxScanRow]   # newest first


class KmScanResult(BaseModel):
    code: str
    verdict: str      # match | duplicate | extra | unknown
    reason: str = ""


class KmScanBatchOut(BaseModel):
    results: list[KmScanResult]
    matched: int
    extras: int
    duplicates: int
    unknowns: int
    state: BoxCheckState


# ─────────────────────────── helpers ────────────────────────────
def _load_box(sess: Session, box_id: int, user: User) -> BoxCheck:
    box = sess.get(BoxCheck, box_id)
    if box is None:
        raise HTTPException(404, "audit topilmadi")
    # Any authenticated user can view; only the owner or an admin can mutate.
    return box


def _require_own_or_admin(box: BoxCheck, user: User) -> None:
    if user.role == "admin":
        return
    if box.created_by == user.id:
        return
    raise HTTPException(403, "bu audit boshqa foydalanuvchi tomonidan boshlangan")


def _compose_state(sess: Session, box: BoxCheck) -> BoxCheckState:
    expected: list[str] = list(box.expected_json or [])
    expected_set = set(expected)

    scans = list(sess.execute(
        select(BoxCheckScan)
        .where(BoxCheckScan.box_check_id == box.id)
        .order_by(desc(BoxCheckScan.scanned_at), desc(BoxCheckScan.id))
    ).scalars())

    matched_codes: list[str] = []
    matched_set: set[str] = set()
    extras: list[str] = []
    extras_set: set[str] = set()
    for row in reversed(scans):   # chronological for ordered "first-seen"
        if row.verdict == "match" and row.code not in matched_set:
            matched_codes.append(row.code); matched_set.add(row.code)
        elif row.verdict == "extra" and row.code not in extras_set:
            extras.append(row.code); extras_set.add(row.code)
        # 'duplicate' and 'unknown' don't add to the tallies.
    missing = [c for c in expected if c not in matched_set]

    return BoxCheckState(
        box=BoxCheckOut.model_validate(box),
        expected_kms=expected,
        matched=matched_codes,
        extras=extras,
        missing=missing,
        matched_count=len(matched_codes),
        extra_count=len(extras),
        missing_count=len(missing),
        scans=[BoxScanRow.model_validate(s) for s in scans],
    )


# ─────────────────────────── endpoints ──────────────────────────
@router.post("/scan-box", response_model=BoxCheckState, status_code=201)
def scan_box(body: ScanBoxIn,
             sess: Session = Depends(get_session),
             u: User = Depends(current_user)):
    """Scan an SSCC. Verify + fetch children + create an active audit row.

    Reuses an existing active audit if the same user is already auditing the
    same SSCC — that survives page reloads and accidental double-taps.
    """
    inn     = body.inn.strip()
    api_key = body.api_key.strip()
    raw     = body.sscc.strip()

    kind = classify_scan(raw)
    if kind != "sscc":
        raise HTTPException(400, "bu quti (SSCC) kodi emas")
    try:
        canonical = normalize_sscc(raw)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Reuse an active audit for the same (user, sscc) so a reload just
    # reopens the existing one instead of forking.
    existing = sess.execute(
        select(BoxCheck).where(
            BoxCheck.created_by == u.id,
            BoxCheck.sscc == canonical,
            BoxCheck.status == "active",
        ).limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return _compose_state(sess, existing)

    # Best-effort api-key/INN ownership check — cheap and catches the classic
    # "typed the wrong company" mistake before we bother ASL with the SSCC.
    v = verify_api_key_ownership(inn, api_key)
    if v.get("success") and isinstance(v.get("data"), dict):
        tin_correct = v["data"].get("isTinCorrect")
        if tin_correct is False:
            raise HTTPException(400, "API kalit bu INN ga tegishli emas")

    resp = fetch_box_children(api_key=api_key, inn=inn, sscc=canonical)
    verdict = resp.get("verdict")
    if verdict == "forbidden":
        raise HTTPException(400,
            "Bu quti (SSCC) boshqa kompaniyaga tegishli — kompaniyani tekshiring")
    if verdict == "missing":
        raise HTTPException(404,
            "Bu SSCC ASL Belgisi tizimida topilmadi")
    if verdict != "owned":
        err = resp.get("error") or "noma'lum xato"
        raise HTTPException(502, f"ASL javobi tushunilmadi: {err}")

    children: list[str] = list(resp.get("children") or [])
    if not children:
        # ASL confirmed the SSCC but returned no children — an empty box has
        # nothing to audit; refuse rather than silently accept.
        raise HTTPException(400,
            "Bu qutida ASL ma'lumotlariga ko'ra hech qanday KM yo'q")

    box = BoxCheck(
        created_by=u.id,
        company_name=body.company_name.strip(),
        owner_inn=inn,
        api_key=api_key,
        sscc=canonical,
        expected_json=children,
        expected_count=len(children),
        product_name=resp.get("product_name") or "",
        gtin=resp.get("gtin") or "",
        package_type=resp.get("package_type") or "",
        status="active",
    )
    sess.add(box)
    sess.flush()
    return _compose_state(sess, box)


@router.get("/{box_id}", response_model=BoxCheckState)
def get_state(box_id: int,
              sess: Session = Depends(get_session),
              u: User = Depends(current_user)):
    box = _load_box(sess, box_id, u)
    return _compose_state(sess, box)


@router.post("/{box_id}/scan", response_model=KmScanBatchOut)
def scan_km(box_id: int, body: ScanKmIn,
            sess: Session = Depends(get_session),
            u: User = Depends(current_user)):
    """Score a burst of KM scans against the expected set for this box."""
    box = _load_box(sess, box_id, u)
    _require_own_or_admin(box, u)
    if box.status != "active":
        raise HTTPException(400, "bu audit yopilgan — yangi quti oching")

    expected_set = set(box.expected_json or [])

    # Preload already-matched codes in this audit so a re-scan is a duplicate,
    # not a fresh match. One query beats N per-code queries.
    already_matched: set[str] = set(sess.execute(
        select(BoxCheckScan.code)
        .where(BoxCheckScan.box_check_id == box.id,
               BoxCheckScan.verdict == "match")
    ).scalars())

    results: list[KmScanResult] = []
    counts = {"match": 0, "duplicate": 0, "extra": 0, "unknown": 0}

    for raw in body.codes:
        raw_str = (raw or "").strip()
        if not raw_str:
            continue
        kind = classify_scan(raw_str)
        if kind != "km":
            code = raw_str
            verdict = "unknown"
            reason = "bu KM kodi emas"
        else:
            code = canonical_km(raw_str)
            if code in expected_set:
                if code in already_matched:
                    verdict = "duplicate"
                    reason = f"takroriy — bu KM allaqachon skanerlangan"
                else:
                    verdict = "match"
                    reason = ""
                    already_matched.add(code)
            else:
                verdict = "extra"
                reason = "bu KM ushbu qutida yo'q (ASL bo'yicha)"

        sess.add(BoxCheckScan(
            box_check_id=box.id,
            code=code,
            verdict=verdict,
            raw=raw_str,
            scanned_by=u.id,
        ))
        results.append(KmScanResult(code=code, verdict=verdict, reason=reason))
        counts[verdict] += 1

    sess.flush()
    state = _compose_state(sess, box)
    return KmScanBatchOut(
        results=results,
        matched=counts["match"],
        duplicates=counts["duplicate"],
        extras=counts["extra"],
        unknowns=counts["unknown"],
        state=state,
    )


@router.post("/{box_id}/close", response_model=BoxCheckState)
def close_box(box_id: int,
              sess: Session = Depends(get_session),
              u: User = Depends(current_user)):
    box = _load_box(sess, box_id, u)
    _require_own_or_admin(box, u)
    if box.status != "active":
        return _compose_state(sess, box)

    state = _compose_state(sess, box)
    if state.matched_count == box.expected_count and state.extra_count == 0:
        box.status = "closed_ok"
    else:
        box.status = "closed_mismatch"
    box.closed_at = datetime.now(timezone.utc)
    sess.flush()
    return _compose_state(sess, box)


@router.post("/{box_id}/reopen", response_model=BoxCheckState)
def reopen_box(box_id: int,
               sess: Session = Depends(get_session),
               u: User = Depends(current_user)):
    """Reopen a closed audit for more scanning — handy when an operator
    finalized too early. Only the owner or an admin may do it, and only from
    a closed_* status (an abandoned one stays abandoned)."""
    box = _load_box(sess, box_id, u)
    _require_own_or_admin(box, u)
    if box.status not in ("closed_ok", "closed_mismatch"):
        raise HTTPException(400, "bu auditni qayta ochib bo'lmaydi")
    # Same-user active-SSCC uniqueness guards against reopening two copies of
    # the same physical box; check explicitly for a friendlier error message.
    clash = sess.execute(
        select(BoxCheck.id).where(
            BoxCheck.created_by == box.created_by,
            BoxCheck.sscc == box.sscc,
            BoxCheck.status == "active",
            BoxCheck.id != box.id,
        ).limit(1)
    ).first()
    if clash is not None:
        raise HTTPException(409,
            "Bu SSCC uchun boshqa faol audit mavjud — avval uni yoping")
    box.status = "active"
    box.closed_at = None
    sess.flush()
    return _compose_state(sess, box)


@router.delete("/{box_id}", status_code=204)
def delete_box_check(box_id: int,
                     sess: Session = Depends(get_session),
                     _u: User = Depends(require_admin)):
    box = sess.get(BoxCheck, box_id)
    if box is None:
        raise HTTPException(404, "audit topilmadi")
    sess.delete(box)
    sess.flush()
    return None


@router.get("", response_model=list[BoxCheckOut])
def list_recent(limit: int = 50,
                mine_only: bool = True,
                sess: Session = Depends(get_session),
                u: User = Depends(current_user)):
    """List recent audits, newest first. Defaults to the caller's own."""
    limit = max(1, min(int(limit or 50), 200))
    q = select(BoxCheck).order_by(desc(BoxCheck.opened_at)).limit(limit)
    if mine_only:
        q = q.where(BoxCheck.created_by == u.id)
    rows = list(sess.execute(q).scalars())
    return [BoxCheckOut.model_validate(r) for r in rows]
