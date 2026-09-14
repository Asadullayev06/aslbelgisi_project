"""Reporting module — a lightweight "just don't scan the same code twice"
per-series list. Sits alongside aggregation + inventory:

  * One project = one series, grouped by product (same picker structure).
  * Scans go into a single flat ReportScan list; the ONLY rule is that a code
    can appear at most once per series (UNIQUE(project_id, code)).
  * KM and SSCC are both accepted; canonical form is what dedup uses.
  * Excel export of the raw scan list, one code per row, cells forced to text
    so Excel keeps the SSCC's leading zeros.
"""
from __future__ import annotations

import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import Project, ReportScan, User
from ..services.codes import canonical_km, classify_scan, normalize_sscc

router = APIRouter(prefix="/api/reporting", tags=["reporting"])


# ─────────────────────────── schemas ────────────────────────────
class ReportProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    product_name: str = Field(min_length=1)
    series_name: str = Field(min_length=1)


class ScanIn(BaseModel):
    code: str = Field(min_length=1)


class BatchIn(BaseModel):
    codes: list[str] = Field(min_length=1)


class ScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    kind: str
    scanned_at: datetime


class ScanResult(BaseModel):
    code: str            # canonical (or the raw string if unrecognisable)
    kind: str            # 'km' | 'sscc' | 'unknown'
    accepted: bool
    reason: str = ""     # empty if accepted


class ReportState(BaseModel):
    project_id: int
    total: int
    km_count: int
    sscc_count: int
    scans: list[ScanOut]   # newest first


# ─────────────────────────── helpers ────────────────────────────
def _load_project(sess: Session, project_id: int) -> Project:
    p = sess.get(Project, project_id)
    if p is None or p.mode != "reporting":
        raise HTTPException(404, "reporting loyihasi topilmadi")
    return p


def _state(sess: Session, project_id: int) -> ReportState:
    counts = dict(sess.execute(
        select(ReportScan.kind, func.count(ReportScan.id))
        .where(ReportScan.project_id == project_id)
        .group_by(ReportScan.kind)
    ).all())
    scans = list(sess.execute(
        select(ReportScan)
        .where(ReportScan.project_id == project_id)
        .order_by(desc(ReportScan.scanned_at), desc(ReportScan.id))
    ).scalars())
    return ReportState(
        project_id=project_id,
        total=len(scans),
        km_count=int(counts.get("km", 0)),
        sscc_count=int(counts.get("sscc", 0)),
        scans=scans,
    )


def _canonicalize(raw: str) -> tuple[str, str]:
    """(canonical_code, kind) — kind in {'km','sscc','unknown'}."""
    kind = classify_scan(raw)
    if kind == "km":
        c = canonical_km(raw)
        return c, "km"
    if kind == "sscc":
        try:
            return normalize_sscc(raw.strip()), "sscc"
        except ValueError:
            return raw.strip(), "unknown"
    return raw.strip(), "unknown"


# ─────────────────────────── endpoints ──────────────────────────
@router.post("/projects", status_code=201)
def create_project(body: ReportProjectCreate,
                   sess: Session = Depends(get_session),
                   u: User = Depends(require_admin)) -> dict:
    """Create one reporting series (= one project), grouped by (name, product)."""
    name = body.name.strip()
    product = body.product_name.strip()
    series = body.series_name.strip()

    # Duplicate series within the same product group -> 409, same rule as inventory.
    clash = sess.execute(
        select(Project.id).where(
            Project.mode == "reporting",
            Project.name == name,
            Project.product_name == product,
            Project.series == series,
        ).limit(1)
    ).first()
    if clash is not None:
        raise HTTPException(409, f"bu mahsulotda '{series}' seriyasi allaqachon mavjud")

    p = Project(
        name=name, product_name=product,
        total_boxes=0, per_box=0, has_loose=False, loose_qty=0,
        series=series,
        business_place_id="", production_order_id="",
        status="active",
        mode="reporting",
        created_by=u.id,
    )
    sess.add(p)
    sess.flush()
    return {"id": p.id, "name": p.name, "product_name": p.product_name,
            "series": p.series}


@router.get("/projects/{project_id}", response_model=ReportState)
def get_state(project_id: int,
              sess: Session = Depends(get_session),
              _u: User = Depends(current_user)):
    _load_project(sess, project_id)
    return _state(sess, project_id)


@router.post("/projects/{project_id}/scan")
def scan_batch(project_id: int, body: BatchIn,
               sess: Session = Depends(get_session),
               u: User = Depends(current_user)) -> dict:
    """Accept a burst of scans. Each code independently: canonicalise, then
    dedup INSERT via ON CONFLICT DO NOTHING scoped to this series."""
    project = _load_project(sess, project_id)
    if project.status != "active":
        raise HTTPException(400, "loyiha faol emas")

    codes = [c for c in (body.codes or []) if c and c.strip()]
    if not codes:
        raise HTTPException(400, "codes required")

    results: list[ScanResult] = []
    for raw in codes:
        code, kind = _canonicalize(raw)
        if kind == "unknown":
            results.append(ScanResult(code=code, kind="unknown", accepted=False,
                                      reason=f"tanib bo'lmadigan kod: {raw[:40]}"))
            continue
        # Atomic: insert if not there, else no-op. psycopg reports rowcount=-1
        # for ON CONFLICT DO NOTHING regardless of insert vs conflict, so we
        # use RETURNING id — a row was created iff we got an id back.
        stmt = (
            pg_insert(ReportScan)
            .values(project_id=project_id, code=code, kind=kind,
                    raw=raw.strip(), scanned_by=u.id)
            .on_conflict_do_nothing(index_elements=["project_id", "code"])
            .returning(ReportScan.id)
        )
        new_id = sess.execute(stmt).scalar_one_or_none()
        if new_id is not None:
            results.append(ScanResult(code=code, kind=kind, accepted=True))
        else:
            results.append(ScanResult(code=code, kind=kind, accepted=False,
                                      reason=f"takroriy — allaqachon skanerlangan: {code}"))
    sess.flush()
    state = _state(sess, project_id)
    return {"results": [r.model_dump() for r in results],
            "accepted": sum(1 for r in results if r.accepted),
            "rejected": sum(1 for r in results if not r.accepted),
            "state": state.model_dump()}


@router.delete("/projects/{project_id}/scans/{scan_id}", response_model=ReportState)
def delete_scan(project_id: int, scan_id: int,
                sess: Session = Depends(get_session),
                _u: User = Depends(require_admin)):
    """Admin undo — remove one code from this series' list."""
    project = _load_project(sess, project_id)
    row = sess.get(ReportScan, scan_id)
    if row is None or row.project_id != project.id:
        raise HTTPException(404, "kod topilmadi")
    sess.delete(row)
    sess.flush()
    return _state(sess, project_id)


@router.get("/projects/{project_id}/export")
def export_xlsx(project_id: int,
                sess: Session = Depends(get_session),
                _u: User = Depends(current_user)):
    """Excel export — ONE column ("Kod"), one row per scan, in scan order.

    Cells are formatted as text (@) so Excel preserves SSCC leading zeros
    ("00286..." stays "00286..." instead of turning into 2.86e+19)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    project = _load_project(sess, project_id)

    rows = list(sess.execute(
        select(ReportScan.code)
        .where(ReportScan.project_id == project_id)
        .order_by(ReportScan.scanned_at.asc(), ReportScan.id.asc())
    ))

    wb = Workbook()
    ws = wb.active
    ws.title = "Kodlar"
    # Header
    ws.append(["Kod"])
    ws.cell(row=1, column=1).font = Font(bold=True, color="FFFFFF")
    ws.cell(row=1, column=1).fill = PatternFill("solid", fgColor="1F6F5C")
    ws.cell(row=1, column=1).alignment = Alignment(horizontal="left")
    ws.freeze_panes = "A2"

    # Column-wide text format keeps SSCC "00..." from becoming a number.
    ws.column_dimensions["A"].number_format = "@"
    ws.column_dimensions["A"].width = 44

    for (code,) in rows:
        row_idx = ws.max_row + 1
        # Prepend an apostrophe? No — the @ format is enough, and an
        # apostrophe would show as data outside Excel. Keep the raw string.
        ws.append([str(code)])
        ws.cell(row=row_idx, column=1).number_format = "@"

    buf = io.BytesIO()
    wb.save(buf)
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_"
                   for ch in f"{project.product_name}_{project.series}".strip("_"))
    filename = f"{safe or f'reporting-{project_id}'}.xlsx"
    # Also RFC 5987 encode the filename so non-ASCII product names survive.
    from urllib.parse import quote
    cd = (f'attachment; filename="{filename}"; '
          f"filename*=UTF-8''{quote(filename)}")
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": cd,
                 "Cache-Control": "no-store",
                 "X-Content-Type-Options": "nosniff"},
    )
