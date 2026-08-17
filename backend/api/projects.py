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
from ..schemas import (
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
    sess: Session = Depends(get_session),
    _u: User = Depends(current_user),
):
    q = select(Project).order_by(Project.created_at.desc())
    if status:
        q = q.where(Project.status == status)
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

    errors: list[str] = []
    if not km_codes:
        errors.append("KM ro'yxati bo'sh")
    elif len(km_codes) < planned_km:
        errors.append(
            f"KM yetarli emas: {len(km_codes)} berildi, reja {planned_km} "
            f"({full_boxes} to'liq × {body.per_box}"
            + (f" + {body.loose_qty} loose" if body.has_loose else "")
            + ")"
        )
    if not box_codes:
        errors.append("Quti (SSCC) ro'yxati bo'sh")
    elif len(box_codes) < body.total_boxes:
        errors.append(f"Quti kodlari yetarli emas: {len(box_codes)} berildi, "
                      f"reja {body.total_boxes}")
    if errors:
        raise HTTPException(400, "  ·  ".join(errors))

    project = Project(
        name=body.name.strip(),
        product_name=body.product_name.strip(),
        total_boxes=body.total_boxes,
        per_box=body.per_box,
        has_loose=body.has_loose,
        loose_qty=body.loose_qty if body.has_loose else 0,
        business_place_id=body.business_place_id.strip(),      # can be empty — set at submit time
        production_order_id=body.production_order_id.strip(),
        status="active",
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
