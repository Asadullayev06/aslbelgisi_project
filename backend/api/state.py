"""Compute a full ScanState for the client. Reused by scanning & projects APIs."""
from __future__ import annotations

from sqlalchemy import and_, desc, func, select
from sqlalchemy.orm import Session, aliased

from ..models import Box, BoxPool, KmPool, OpenBox, Project
from ..schemas import ClosedBoxOut, MissingPreview, ProjectPlan, ScanState

MISSING_PREVIEW_LIMIT = 16


def build_state(sess: Session, project_id: int, user_id: int) -> ScanState:
    project = sess.get(Project, project_id)
    if project is None:
        raise LookupError("project not found")
    is_inventory = (project.mode == "inventory")

    # One grouped query instead of three. build_state runs on EVERY scan, and
    # each extra round-trip to Neon is latency the barcode gun has to wait on.
    #
    # Inventory quirk: the same km_code can occupy multiple planned rows (one
    # per series). We want counts of PHYSICAL codes, not rows, so distinct
    # by km_code within a status.
    if is_inventory:
        km_by_status = dict(sess.execute(
            select(KmPool.status, func.count(func.distinct(KmPool.km_code)))
            .where(KmPool.project_id == project_id)
            .group_by(KmPool.status)
        ).all())
    else:
        km_by_status = dict(sess.execute(
            select(KmPool.status, func.count(KmPool.id))
            .where(KmPool.project_id == project_id)
            .group_by(KmPool.status)
        ).all())
    aggregated_km = int(km_by_status.get("aggregated", 0))
    claimed_km    = int(km_by_status.get("claimed", 0))
    pending_km    = int(km_by_status.get("pending", 0))
    total_km      = aggregated_km + claimed_km + pending_km
    scanned_km    = aggregated_km + claimed_km

    # Likewise: one query covers both box buckets.
    box_by_kind = dict(sess.execute(
        select(Box.is_loose, func.count(Box.id))
        .where(Box.project_id == project_id)
        .group_by(Box.is_loose)
    ).all())
    full_closed  = int(box_by_kind.get(False, 0))
    loose_closed = int(box_by_kind.get(True, 0)) > 0

    # Box list. For inventory boxes we also count distinct km_codes and split
    # matched vs extra (matched = code that has ANY planned row with a
    # non-empty series in this project).
    if is_inventory:
        box_rows = list(sess.execute(
            select(Box, func.count(func.distinct(KmPool.km_code)))
            .join(KmPool, KmPool.box_id == Box.id, isouter=True)
            .where(Box.project_id == project_id)
            .group_by(Box.id)
            .order_by(Box.closed_at.asc(), Box.id.asc())
        ))
        # One extra query to count "extras per box" — a km inside the box for
        # which the project has ZERO planned (series != '') rows. NOT EXISTS
        # against an aliased KmPool row keeps this as a single query.
        planned = aliased(KmPool)
        box_ids = [b.id for (b, _c) in box_rows]
        extras_by_box: dict[int, int] = {}
        if box_ids:
            extras_by_box = dict(sess.execute(
                select(KmPool.box_id,
                       func.count(func.distinct(KmPool.km_code)))
                .where(
                    KmPool.box_id.in_(box_ids),
                    KmPool.project_id == project_id,
                    ~select(planned.id).where(
                        and_(planned.project_id == project_id,
                             planned.km_code == KmPool.km_code,
                             planned.series != "")
                    ).exists(),
                )
                .group_by(KmPool.box_id)
            ).all())
        closed_boxes = []
        for (b, cnt) in box_rows:
            n = int(cnt or 0)
            ex = int(extras_by_box.get(b.id, 0))
            closed_boxes.append(ClosedBoxOut(
                id=b.id, sscc=b.sscc, codes_count=n, capacity=b.capacity,
                is_loose=b.is_loose, closed_at=b.closed_at,
                matched_count=max(0, n - ex), extra_count=ex,
            ))
    else:
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

    # Operator's open box. For inventory the same code can occupy multiple
    # planned rows (one per series) — distinct so the UI counts physical
    # codes, not manifest rows.
    open_box = sess.execute(
        select(OpenBox).where(OpenBox.project_id == project_id, OpenBox.user_id == user_id)
    ).scalar_one_or_none()
    if open_box is None:
        current_codes = []
        current_is_loose = False
    else:
        if is_inventory:
            current_codes = [c for (c,) in sess.execute(
                select(KmPool.km_code)
                .where(KmPool.open_box_id == open_box.id)
                .group_by(KmPool.km_code)
                .order_by(func.min(KmPool.claimed_at).asc(),
                          func.min(KmPool.id).asc())
            )]
        else:
            current_codes = [c for (c,) in sess.execute(
                select(KmPool.km_code).where(KmPool.open_box_id == open_box.id)
                .order_by(KmPool.claimed_at.asc(), KmPool.id.asc())
            )]
        current_is_loose = open_box.is_loose
    # Inventory has no capacity. Return a huge number so the frontend
    # progress bar/slots renderer can detect and hide themselves.
    if is_inventory:
        current_capacity = 0
    else:
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

    # Inventory-only: distinct list of uploaded series names.
    inv_series: list[str] = []
    if is_inventory:
        inv_series = [
            s for (s,) in sess.execute(
                select(KmPool.series)
                .where(KmPool.project_id == project_id, KmPool.series != "")
                .group_by(KmPool.series)
                .order_by(KmPool.series.asc())
            )
        ]

    plan = ProjectPlan(
        id=project.id, name=project.name, product_name=project.product_name,
        total_boxes=project.total_boxes, per_box=project.per_box,
        has_loose=project.has_loose, loose_qty=project.loose_qty,
        status=project.status, mode=project.mode or "aggregation",
        created_at=project.created_at,
        full_boxes=project.full_boxes, planned_km=project.planned_km,
        series=project.series or "",
        inventory_series=inv_series,
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
