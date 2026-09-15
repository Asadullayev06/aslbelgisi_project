"""Box-check module — audit a physical box against ASL Belgisi's records.

Now project-based like Inventory / Reporting: each product/series is one
`Project(mode='box_check')` that carries the company INN + API key. The
operator picks a series first, then scans boxes under it. Every scanned
SSCC creates one `box_checks` row bound to that project.

Endpoints
---------
  POST   /api/box-check/projects              admin  create a series
  GET    /api/box-check/projects/{id}          any   project + its audits
  POST   /api/box-check/projects/{id}/scan-box any   open a new box audit
  GET    /api/box-check/{id}                   any   full audit state
  POST   /api/box-check/{id}/scan              own   score a KM batch
  POST   /api/box-check/{id}/close             own   freeze the audit
  POST   /api/box-check/{id}/reopen            own   reopen a closed audit
  DELETE /api/box-check/{id}                  admin  discard an audit
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import BoxCheck, BoxCheckScan, Project, User
from ..services import asl_stock
from ..services.asl_stock import fetch_box_children
from ..services.codes import canonical_km, classify_scan, normalize_sscc

router = APIRouter(prefix="/api/box-check", tags=["box-check"])


# ─────────────────────────── schemas ────────────────────────────
class BoxCheckProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    product_name: str = Field(min_length=1)
    series_name: str = Field(min_length=1)
    inn: str = Field(min_length=1)
    api_key: str = Field(min_length=1)


class BoxCheckProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    product_name: str
    series: str
    asl_check_inn: str
    status: str
    created_at: datetime


class ScanBoxIn(BaseModel):
    sscc: str = Field(min_length=1)


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
    project_id: int | None = None
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


class ProjectAuditsOut(BaseModel):
    project: BoxCheckProjectOut
    audits: list[BoxCheckOut]


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
def _load_project(sess: Session, project_id: int) -> Project:
    p = sess.get(Project, project_id)
    if p is None or p.mode != "box_check":
        raise HTTPException(404, "Quti tekshiruvi loyihasi topilmadi")
    return p


def _load_box(sess: Session, box_id: int) -> BoxCheck:
    box = sess.get(BoxCheck, box_id)
    if box is None:
        raise HTTPException(404, "audit topilmadi")
    return box


def _require_own_or_admin(box: BoxCheck, user: User) -> None:
    if user.role == "admin":
        return
    if box.created_by == user.id:
        return
    raise HTTPException(403, "bu audit boshqa foydalanuvchi tomonidan boshlangan")


def _compose_state(sess: Session, box: BoxCheck) -> BoxCheckState:
    expected: list[str] = list(box.expected_json or [])

    scans = list(sess.execute(
        select(BoxCheckScan)
        .where(BoxCheckScan.box_check_id == box.id)
        .order_by(desc(BoxCheckScan.scanned_at), desc(BoxCheckScan.id))
    ).scalars())

    matched_codes: list[str] = []
    matched_set: set[str] = set()
    extras: list[str] = []
    extras_set: set[str] = set()
    for row in reversed(scans):
        if row.verdict == "match" and row.code not in matched_set:
            matched_codes.append(row.code); matched_set.add(row.code)
        elif row.verdict == "extra" and row.code not in extras_set:
            extras.append(row.code); extras_set.add(row.code)
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


# ─────────────────────────── project CRUD ───────────────────────
@router.post("/projects", response_model=BoxCheckProjectOut, status_code=201)
def create_project(body: BoxCheckProjectCreate,
                   sess: Session = Depends(get_session),
                   u: User = Depends(require_admin)):
    """Create one Quti tekshiruvi series (= one project), grouped by (name,
    product). The INN + API key are stored on the project so any operator
    working in this series doesn't need to re-enter them."""
    name        = body.name.strip()
    product     = body.product_name.strip()
    series_name = body.series_name.strip()
    inn         = body.inn.strip()
    api_key     = body.api_key.strip()

    # Guard against a duplicate series within the same product group.
    clash = sess.execute(
        select(Project.id).where(
            Project.mode == "box_check",
            Project.name == name,
            Project.product_name == product,
            Project.series == series_name,
        ).limit(1)
    ).first()
    if clash is not None:
        raise HTTPException(409, f"bu mahsulotda '{series_name}' seriyasi allaqachon mavjud")

    # Fail fast: the same api-keys/check the auth step of the old UI used.
    v = asl_stock.verify_api_key_ownership(inn, api_key)
    if not v.get("success"):
        raise HTTPException(400, f"ASL API kalitni tekshirib bo'lmadi: {v.get('error','')}")
    data = v.get("data") or {}
    if isinstance(data, dict) and data.get("isTinCorrect") is False:
        raise HTTPException(400, "API kalit ushbu INN ga tegishli emas")

    p = Project(
        name=name, product_name=product,
        total_boxes=0, per_box=0, has_loose=False, loose_qty=0,
        series=series_name,
        business_place_id="", production_order_id="",
        status="active",
        mode="box_check",
        asl_check_enabled=True,
        asl_check_inn=inn,
        asl_check_api_key=api_key,
        created_by=u.id,
    )
    sess.add(p)
    sess.flush()
    return BoxCheckProjectOut.model_validate(p)


@router.get("/projects/{project_id}", response_model=ProjectAuditsOut)
def get_project(project_id: int,
                sess: Session = Depends(get_session),
                _u: User = Depends(current_user)):
    p = _load_project(sess, project_id)
    audits = list(sess.execute(
        select(BoxCheck)
        .where(BoxCheck.project_id == project_id)
        .order_by(desc(BoxCheck.opened_at))
        .limit(200)
    ).scalars())
    return ProjectAuditsOut(
        project=BoxCheckProjectOut.model_validate(p),
        audits=[BoxCheckOut.model_validate(a) for a in audits],
    )


@router.post("/projects/{project_id}/scan-box",
             response_model=BoxCheckState, status_code=201)
def scan_box(project_id: int, body: ScanBoxIn,
             sess: Session = Depends(get_session),
             u: User = Depends(current_user)):
    """Scan an SSCC under an existing series. Verify + fetch children +
    create an active audit row. Reuses an active audit if this user is
    already auditing this SSCC (survives page reloads)."""
    project = _load_project(sess, project_id)
    if project.status != "active":
        raise HTTPException(400, "loyiha faol emas")

    raw = body.sscc.strip()
    kind = classify_scan(raw)
    if kind != "sscc":
        raise HTTPException(400, "bu quti (SSCC) kodi emas")
    try:
        canonical = normalize_sscc(raw)
    except ValueError as e:
        raise HTTPException(400, str(e))

    existing = sess.execute(
        select(BoxCheck).where(
            BoxCheck.project_id == project_id,
            BoxCheck.created_by == u.id,
            BoxCheck.sscc == canonical,
            BoxCheck.status == "active",
        ).limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return _compose_state(sess, existing)

    resp = fetch_box_children(api_key=project.asl_check_api_key,
                              inn=project.asl_check_inn, sscc=canonical)
    verdict = resp.get("verdict")
    if verdict == "forbidden":
        raise HTTPException(400,
            "Bu quti (SSCC) boshqa kompaniyaga tegishli — seriyani tekshiring")
    if verdict == "missing":
        raise HTTPException(404,
            "Bu SSCC ASL Belgisi tizimida topilmadi")
    if verdict != "owned":
        err = resp.get("error") or "noma'lum xato"
        raise HTTPException(502, f"ASL javobi tushunilmadi: {err}")

    children: list[str] = list(resp.get("children") or [])
    if not children:
        raise HTTPException(400,
            "Bu qutida ASL ma'lumotlariga ko'ra hech qanday KM yo'q")

    box = BoxCheck(
        project_id=project.id,
        created_by=u.id,
        company_name=project.name,
        owner_inn=project.asl_check_inn,
        api_key=project.asl_check_api_key,
        sscc=canonical,
        expected_json=children,
        expected_count=len(children),
        product_name=resp.get("product_name") or project.product_name,
        gtin=resp.get("gtin") or "",
        package_type=resp.get("package_type") or "",
        status="active",
    )
    sess.add(box)
    sess.flush()
    return _compose_state(sess, box)


# ─────────────────────────── audit endpoints ────────────────────
@router.get("/{box_id}", response_model=BoxCheckState)
def get_state(box_id: int,
              sess: Session = Depends(get_session),
              _u: User = Depends(current_user)):
    return _compose_state(sess, _load_box(sess, box_id))


@router.post("/{box_id}/scan", response_model=KmScanBatchOut)
def scan_km(box_id: int, body: ScanKmIn,
            sess: Session = Depends(get_session),
            u: User = Depends(current_user)):
    box = _load_box(sess, box_id)
    _require_own_or_admin(box, u)
    if box.status != "active":
        raise HTTPException(400, "bu audit yopilgan — yangi quti oching")

    expected_set = set(box.expected_json or [])
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
                    reason = "takroriy — bu KM allaqachon skanerlangan"
                else:
                    verdict = "match"
                    reason = ""
                    already_matched.add(code)
            else:
                verdict = "extra"
                reason = "bu KM ushbu qutida yo'q (ASL bo'yicha)"

        sess.add(BoxCheckScan(
            box_check_id=box.id, code=code, verdict=verdict,
            raw=raw_str, scanned_by=u.id,
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
    box = _load_box(sess, box_id)
    _require_own_or_admin(box, u)
    if box.status != "active":
        return _compose_state(sess, box)
    state = _compose_state(sess, box)
    box.status = ("closed_ok"
                  if state.matched_count == box.expected_count and state.extra_count == 0
                  else "closed_mismatch")
    box.closed_at = datetime.now(timezone.utc)
    sess.flush()
    return _compose_state(sess, box)


@router.post("/{box_id}/reopen", response_model=BoxCheckState)
def reopen_box(box_id: int,
               sess: Session = Depends(get_session),
               u: User = Depends(current_user)):
    box = _load_box(sess, box_id)
    _require_own_or_admin(box, u)
    if box.status not in ("closed_ok", "closed_mismatch"):
        raise HTTPException(400, "bu auditni qayta ochib bo'lmaydi")
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
