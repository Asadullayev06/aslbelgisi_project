"""Project CRUD + file parse + full-state read.

Auth:
  GET      — any logged-in user
  POST     — admin only
  parse    — any logged-in user (uploaded pool preview)
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import BoxPool, KmPool, Project, User
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete

from ..schemas import (
    InventoryProjectCreate,
    ParseFileResult,
    ProjectCreate,
    ProjectSummary,
    ScanState,
)
from ..services.codes import (
    parse_box_file,
    parse_box_pool_text,
    parse_km_file,
    parse_pool_text,
)
from .state import build_state

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── list / get ──────────────────────────────────────────────
@router.get("", response_model=list[ProjectSummary])
def list_projects(
    status: str | None = Query(None),
    mode: str | None = Query(None),   # "aggregation" | "inventory"
    sess: Session = Depends(get_session),
    _u: User = Depends(current_user),
):
    q = select(Project).order_by(Project.created_at.desc())
    if status:
        q = q.where(Project.status == status)
    if mode:
        q = q.where(Project.mode == mode)
    else:
        # Default listing is aggregation-only, so existing consumers (the
        # normal project picker) don't get inventory rows mixed in.
        q = q.where(Project.mode == "aggregation")
    return list(sess.execute(q).scalars())


@router.get("/{project_id}", response_model=ScanState)
def get_project(
    project_id: int,
    sess: Session = Depends(get_session),
    u: User = Depends(current_user),
):
    try:
        return build_state(sess, project_id, u.id)
    except LookupError:
        raise HTTPException(404, "loyiha topilmadi")


# ── create (admin only) ─────────────────────────────────────
@router.post("", response_model=ScanState, status_code=201)
def create_project(
    body: ProjectCreate,
    sess: Session = Depends(get_session),
    u: User = Depends(require_admin),
):
    if body.has_loose and body.loose_qty <= 0:
        raise HTTPException(400, "loose paket uchun dona sonini kiriting")

    km_codes,  km_warns  = parse_pool_text(body.km_codes_text)
    box_codes, box_warns = parse_box_pool_text(body.box_codes_text)

    full_boxes = body.total_boxes - (1 if body.has_loose else 0)
    if full_boxes < 0:
        raise HTTPException(400, "total_boxes noto'g'ri")
    planned_km = full_boxes * body.per_box + (body.loose_qty if body.has_loose else 0)

    # Empty pools are now ALLOWED — an "open" project. The scanning path
    # detects the missing pool per-project and auto-registers codes on the
    # fly, so admin can create a project without pre-loading anything and
    # workers simply scan whatever they have; duplicates are still rejected.
    # If a pool WAS provided, we still verify its size matches the plan.
    errors: list[str] = []
    if km_codes and len(km_codes) < planned_km:
        errors.append(
            f"KM yetarli emas: {len(km_codes)} berildi, reja {planned_km} "
            f"({full_boxes} to'liq × {body.per_box}"
            + (f" + {body.loose_qty} loose" if body.has_loose else "")
            + ")"
        )
    if box_codes and len(box_codes) < body.total_boxes:
        errors.append(f"Quti kodlari yetarli emas: {len(box_codes)} berildi, "
                      f"reja {body.total_boxes}")
    if errors:
        raise HTTPException(400, "  ·  ".join(errors))

    if not body.series.strip():
        raise HTTPException(400, "seriya kiritilishi shart")

    project = Project(
        name=body.name.strip(),
        product_name=body.product_name.strip(),
        total_boxes=body.total_boxes,
        per_box=body.per_box,
        has_loose=body.has_loose,
        loose_qty=body.loose_qty if body.has_loose else 0,
        series=body.series.strip(),
        business_place_id=body.business_place_id.strip(),      # can be empty — set at submit time
        production_order_id=body.production_order_id.strip(),
        status="active",
        # Stay in "open" mode forever if no manifest was uploaded — the
        # scan path auto-registers unknown codes for these projects.
        open_km_pool=not km_codes,
        open_box_pool=not box_codes,
        created_by=u.id,
    )
    sess.add(project)
    sess.flush()

    if km_codes:
        sess.execute(
            pg_insert(KmPool)
            .values([{"project_id": project.id, "km_code": c} for c in km_codes])
            .on_conflict_do_nothing(index_elements=["project_id", "km_code"])
        )
    if box_codes:
        sess.execute(
            pg_insert(BoxPool)
            .values([{"project_id": project.id, "sscc": s} for s in box_codes])
            .on_conflict_do_nothing(index_elements=["project_id", "sscc"])
        )
    sess.flush()
    return build_state(sess, project.id, u.id)


# ── inventory create (admin only) ───────────────────────────
@router.post("/inventory", response_model=ScanState, status_code=201)
def create_inventory_project(
    body: InventoryProjectCreate,
    sess: Session = Depends(get_session),
    u: User = Depends(require_admin),
):
    """Warehouse-count project. Multiple series, KM codes per series, no SSCC
    pool, no capacity. Never sent to ASL Belgisi.

    Duplicate handling (decision c): the SAME km_code can appear in multiple
    series — one km_pool row per (series, code). When a code that lives in
    both Series A and B is scanned, both rows get marked matched, and the
    box view reports both series.
    """
    # Validate every series and its codes up front, so a partial project
    # can't survive a mid-loop failure.
    if not body.series:
        raise HTTPException(400, "kamida bitta seriya kerak")

    series_seen: set[str] = set()
    normalized: list[tuple[str, list[str], list[str]]] = []
    for s in body.series:
        name = s.name.strip()
        if not name:
            raise HTTPException(400, "seriya nomi bo'sh bo'lishi mumkin emas")
        if name in series_seen:
            raise HTTPException(400, f"seriya nomi takrorlanadi: {name}")
        series_seen.add(name)
        codes, warns = parse_pool_text(s.km_codes_text)
        if not codes:
            raise HTTPException(400, f"seriya '{name}' uchun KM ro'yxati bo'sh")
        normalized.append((name, codes, warns))

    project = Project(
        name=body.name.strip(),
        product_name=body.product_name.strip(),
        # Inventory has no plan — the operator scans until they stop.
        total_boxes=0, per_box=0, has_loose=False, loose_qty=0,
        series="",                    # per-code series lives on km_pool rows
        business_place_id="", production_order_id="",
        status="active",
        mode="inventory",
        created_by=u.id,
    )
    sess.add(project)
    sess.flush()

    # Upload every series's codes. Same (project, km, series) is unique;
    # ON CONFLICT DO NOTHING catches accidental within-file dupes so the
    # rest still loads.
    for name, codes, _warns in normalized:
        sess.execute(
            pg_insert(KmPool)
            .values([{"project_id": project.id, "km_code": c, "series": name}
                     for c in codes])
            .on_conflict_do_nothing(index_elements=["project_id", "km_code", "series"])
        )
    sess.flush()
    return build_state(sess, project.id, u.id)


# ── rename / delete (admin only) ────────────────────────────
class ProjectPatch(BaseModel):
    name:                str | None = None
    product_name:        str | None = None
    series:              str | None = None
    business_place_id:   str | None = None
    production_order_id: str | None = None


@router.patch("/{project_id}", response_model=ScanState)
def update_project(project_id: int, body: ProjectPatch,
                   sess: Session = Depends(get_session),
                   u: User = Depends(require_admin)):
    """Rename / edit lightweight metadata. Structural fields (capacity,
    per_box, has_loose, mode) are NOT editable — those would invalidate
    codes already scanned."""
    p = sess.get(Project, project_id)
    if p is None:
        raise HTTPException(404, "loyiha topilmadi")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(400, "loyiha nomi bo'sh bo'lolmaydi")
        p.name = n
    if body.product_name is not None:
        n = body.product_name.strip()
        if not n:
            raise HTTPException(400, "mahsulot nomi bo'sh bo'lolmaydi")
        p.product_name = n
    if body.series is not None:
        p.series = body.series.strip()
    if body.business_place_id is not None:
        p.business_place_id = body.business_place_id.strip()
    if body.production_order_id is not None:
        p.production_order_id = body.production_order_id.strip()
    sess.commit()
    return build_state(sess, p.id, u.id)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int,
                   sess: Session = Depends(get_session),
                   _u: User = Depends(require_admin)):
    """Delete a project and everything it owns (km_pool, box_pool, boxes,
    open_boxes, submissions, scan_events all cascade). Irreversible."""
    p = sess.get(Project, project_id)
    if p is None:
        raise HTTPException(404, "loyiha topilmadi")
    sess.delete(p)
    sess.commit()
    return None


# ── file parse ──────────────────────────────────────────────
@router.post("/parse-file", response_model=ParseFileResult)
async def parse_file(
    kind: Literal["km", "box"] = Query(...),
    file: UploadFile = File(...),
    _u: User = Depends(current_user),
):
    raw = await file.read()
    name = file.filename or ""
    if kind == "km":
        codes, warns = parse_km_file(name, raw)
    else:
        codes, warns = parse_box_file(name, raw)
    return ParseFileResult(kind=kind, codes=codes, warnings=warns, count=len(codes))
