"""Compute a full ScanState for the client. Reused by scanning & projects APIs."""
from __future__ import annotations

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..models import Box, BoxPool, KmPool, OpenBox, Project
from ..schemas import ClosedBoxOut, MissingPreview, ProjectPlan, ScanState

MISSING_PREVIEW_LIMIT = 16


def build_state(sess: Session, project_id: int, user_id: int) -> ScanState:
    project = sess.get(Project, project_id)
    if project is None:
        raise LookupError("project not found")

    total_km      = int(sess.execute(select(func.count(KmPool.id)).where(KmPool.project_id == project_id)).scalar_one())
    aggregated_km = int(sess.execute(select(func.count(KmPool.id)).where(KmPool.project_id == project_id, KmPool.status == "aggregated")).scalar_one())
    claimed_km    = int(sess.execute(select(func.count(KmPool.id)).where(KmPool.project_id == project_id, KmPool.status == "claimed")).scalar_one())
    pending_km    = total_km - aggregated_km - claimed_km
    scanned_km    = aggregated_km + claimed_km

    full_closed = int(sess.execute(
        select(func.count(Box.id)).where(Box.project_id == project_id, Box.is_loose == False)  # noqa: E712
    ).scalar_one())
    loose_closed = int(sess.execute(
        select(func.count(Box.id)).where(Box.project_id == project_id, Box.is_loose == True)   # noqa: E712
    ).scalar_one()) > 0

    box_rows = list(sess.execute(
        select(Box, func.count(KmPool.id))
        .join(KmPool, KmPool.box_id == Box.id, isouter=True)
        .where(Box.project_id == project_id)
        .group_by(Box.id)
        .order_by(Box.closed_at.asc(), Box.id.asc())
    ))
    closed_boxes = [
        ClosedBoxOut(id=b.id, sscc=b.sscc, codes_count=int(cnt or 0),
                     capacity=b.capacity, is_loose=b.is_loose,
                     closed_at=b.closed_at)
        for (b, cnt) in box_rows
    ]

    # Operator's open box.
    open_box = sess.execute(
        select(OpenBox).where(OpenBox.project_id == project_id, OpenBox.user_id == user_id)
    ).scalar_one_or_none()
    if open_box is None:
        current_codes = []
        current_is_loose = False
    else:
        current_codes = [c for (c,) in sess.execute(
            select(KmPool.km_code).where(KmPool.open_box_id == open_box.id)
            .order_by(KmPool.claimed_at.asc(), KmPool.id.asc())
        )]
        current_is_loose = open_box.is_loose
    current_capacity = (project.loose_qty if current_is_loose else project.per_box)

    # Missing panels.
    missing_km_count = pending_km + claimed_km
    missing_km_rows = [c for (c,) in sess.execute(
        select(KmPool.km_code)
        .where(KmPool.project_id == project_id, KmPool.status != "aggregated")
        .order_by(KmPool.id.asc()).limit(MISSING_PREVIEW_LIMIT)
    )]

    missing_box_rows = list(sess.execute(
        select(BoxPool.sscc)
        .where(BoxPool.project_id == project_id, BoxPool.status == "pending")
        .order_by(BoxPool.id.asc()).limit(MISSING_PREVIEW_LIMIT)
    ))
    missing_box_count = int(sess.execute(
        select(func.count(BoxPool.id))
        .where(BoxPool.project_id == project_id, BoxPool.status == "pending")
    ).scalar_one())

    plan = ProjectPlan(
        id=project.id, name=project.name, product_name=project.product_name,
        total_boxes=project.total_boxes, per_box=project.per_box,
        has_loose=project.has_loose, loose_qty=project.loose_qty,
        status=project.status, created_at=project.created_at,
        full_boxes=project.full_boxes, planned_km=project.planned_km,
        business_place_id=project.business_place_id,
        production_order_id=project.production_order_id,
    )

    return ScanState(
        project=plan,
        total_km=total_km,
        scanned_km=scanned_km,
        aggregated_km=aggregated_km,
        pending_km=pending_km,
        full_closed=full_closed,
        loose_closed=loose_closed,
        closed_boxes=closed_boxes,
        current_codes=current_codes,
        current_capacity=current_capacity,
        current_is_loose=current_is_loose,
        missing_km=MissingPreview(count=missing_km_count, preview=missing_km_rows),
        missing_box=MissingPreview(count=missing_box_count,
                                   preview=[s for (s,) in missing_box_rows]),
    )
