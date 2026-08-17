"""ASL Belgisi Open API v1.35 §5.3 client.

Endpoint: POST https://xtrace.aslbelgisi.uz/public/api/v1/doc/aggregation
Auth:     Bearer <API key>
Body:     { "documentBody": "<base64 of inner JSON>", "signature": "" }

Limits per report (§1.4):
  * 30 000 codes
  * 200 GROUP units
  * 100 requests / minute
"""
from __future__ import annotations

import base64
import json
import time
from datetime import datetime, timezone
from typing import Iterable

import requests
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Box, KmPool, Project, Submission

MAX_CODES_PER_REPORT       = 30_000
MAX_GROUP_UNITS_PER_REPORT = 200
REQUEST_TIMEOUT            = 60
RATE_LIMIT_SLEEP_SECS      = 0.7        # ~85 req/min, under the 100 cap


# ── validation ──────────────────────────────────────────────
def validate_ready(sess: Session, project_id: int) -> dict:
    """Return {'ok': bool, 'reasons': [uzbek str]}.

    Same punch-list as page 7 YAKUNLASH: no open KMs, no unscanned KMs,
    correct full-box count, loose closed if planned.
    """
    project = sess.get(Project, project_id)
    if project is None:
        return {"ok": False, "reasons": ["loyiha topilmadi"]}

    reasons: list[str] = []

    open_kms = int(sess.execute(
        select(func.count(KmPool.id)).where(
            KmPool.project_id == project_id, KmPool.status == "claimed"
        )
    ).scalar_one())
    if open_kms:
        reasons.append(f"{open_kms} ta KM ochiq qutida")

    pending_kms = int(sess.execute(
        select(func.count(KmPool.id)).where(
            KmPool.project_id == project_id, KmPool.status == "pending"
        )
    ).scalar_one())
    if pending_kms:
        reasons.append(f"{pending_kms} ta KM skanerlanmagan")

    full_planned = project.total_boxes - (1 if project.has_loose else 0)
    full_closed = int(sess.execute(
        select(func.count(Box.id)).where(
            Box.project_id == project_id, Box.is_loose == False  # noqa: E712
        )
    ).scalar_one())
    if full_closed != full_planned:
        reasons.append(f"to'liq qutilar {full_closed}/{full_planned}")

    if project.has_loose:
        loose_closed = int(sess.execute(
            select(func.count(Box.id)).where(
                Box.project_id == project_id, Box.is_loose == True  # noqa: E712
            )
        ).scalar_one())
        if loose_closed == 0:
            reasons.append("loose paket hali yopilmagan")

    return {"ok": not reasons, "reasons": reasons}


# ── batching + document build ───────────────────────────────
def _batch_boxes(boxes: list[Box],
                 max_units: int = MAX_GROUP_UNITS_PER_REPORT,
                 max_codes: int = MAX_CODES_PER_REPORT,
                 codes_by_box: dict[int, list[str]] | None = None,
                 ) -> list[list[Box]]:
    """Group boxes into reports respecting API caps."""
    reports: list[list[Box]] = []
    cur: list[Box] = []
    cur_code_count = 0
    for b in boxes:
        n = len(codes_by_box[b.id]) if codes_by_box else 0
        if cur and (len(cur) >= max_units or cur_code_count + n > max_codes):
            reports.append(cur)
            cur, cur_code_count = [], 0
        cur.append(b)
        cur_code_count += n
    if cur:
        reports.append(cur)
    return reports


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _build_document_body(units: list[dict], project: Project) -> str:
    bp = project.business_place_id.strip()
    bp_val: int | str = int(bp) if bp.isdigit() else bp
    inner = {
        "aggregationUnits": units,
        "businessPlaceId": bp_val,
        "documentDate": _now_iso(),
    }
    if project.production_order_id.strip():
        inner["productionOrderId"] = project.production_order_id.strip()
    body_json = json.dumps(inner, ensure_ascii=False,
                           separators=(",", ":"), sort_keys=True)
    return base64.b64encode(body_json.encode("utf-8")).decode("utf-8")


# ── submission (one-click mass aggregation) ─────────────────
def submit_project(sess: Session, project_id: int, user_id: int,
                   api_key: str | None = None,
                   business_place_id: str = "",
                   production_order_id: str = "",
                   sleep_secs: float = RATE_LIMIT_SLEEP_SECS,
                   ) -> dict:
    """Package every closed box into as few reports as the caps allow and POST
    them. Idempotent: claims 'submitting' state atomically, and skips reports
    already recorded as ok=TRUE (safe to restart mid-way).

    MOD (businessPlaceId), productionOrderId, and API key are collected at
    submit time (not at project creation), so callers pass them here. Any
    non-empty value is persisted onto the project row so a retry after crash
    doesn't need to be re-entered.
    """
    settings = get_settings()
    key = api_key or settings.asl_api_key
    if not key:
        return {"ok": False, "error": "ASL API kaliti kiritilmagan"}

    # Persist submit-time overrides onto the project row BEFORE claiming
    # 'submitting' so the doc-build below reads the final values.
    project = sess.get(Project, project_id)
    if project is None:
        return {"ok": False, "error": "loyiha topilmadi"}
    bp = (business_place_id or "").strip()
    if bp:
        project.business_place_id = bp
    poid = (production_order_id or "").strip()
    if poid:
        project.production_order_id = poid
    if not project.business_place_id.strip():
        return {"ok": False, "error": "MOD (businessPlaceId) kiritilmagan"}
    sess.commit()

    # Atomic status claim — plan.md §5 step 3. Allow 'submitting' too so a
    # retry after a crash resumes instead of erroring out.
    from sqlalchemy import text as _text
    row = sess.execute(
        _text("UPDATE projects SET status='submitting' "
              "WHERE id=:pid AND status IN ('active','submitting') RETURNING id"),
        {"pid": project_id},
    ).first()
    if row is None:
        return {"ok": False, "error": "loyiha holati yuborishga mos emas"}
    sess.commit()   # release the row lock so parallel readers keep working

    # Gather boxes + their codes.
    boxes: list[Box] = list(sess.execute(
        select(Box).where(Box.project_id == project_id)
        .order_by(Box.is_loose, Box.id)
    ).scalars())
    if not boxes:
        return {"ok": False, "error": "yopilgan qutilar yo'q"}

    codes_by_box: dict[int, list[str]] = {}
    for b in boxes:
        codes = [c for (c,) in sess.execute(
            select(KmPool.km_code).where(KmPool.box_id == b.id)
        )]
        codes_by_box[b.id] = codes

    batches = _batch_boxes(boxes, codes_by_box=codes_by_box)

    project = sess.get(Project, project_id)
    results: list[dict] = []

    for idx, batch in enumerate(batches, start=1):
        # Skip if already succeeded.
        existing = sess.execute(
            select(Submission).where(Submission.project_id == project_id,
                                     Submission.report_index == idx)
        ).scalar_one_or_none()
        if existing and existing.ok:
            results.append({"report_index": idx, "ok": True,
                            "document_id": existing.document_id,
                            "http_status": existing.http_status,
                            "unit_count": existing.unit_count,
                            "code_count": existing.code_count,
                            "sscc_list": [b.sscc for b in batch],
                            "skipped": True})
            continue

        units = [{
            "aggregationItemsCount": len(codes_by_box[b.id]),
            "aggregationUnitCapacity": int(b.capacity),
            "codes": codes_by_box[b.id],
            "unitSerialNumber": b.sscc,
        } for b in batch]
        body_b64 = _build_document_body(units, project)

        # Write intent BEFORE the network call so a crash mid-flight is visible.
        if existing:
            existing.unit_count = len(batch)
            existing.code_count = sum(len(codes_by_box[b.id]) for b in batch)
            existing.document_body = body_b64
            existing.ok = False
            existing.error = None
            existing.submitted_by = user_id
            sub = existing
        else:
            sub = Submission(
                project_id=project_id,
                report_index=idx,
                unit_count=len(batch),
                code_count=sum(len(codes_by_box[b.id]) for b in batch),
                ok=False,
                document_body=body_b64,
                submitted_by=user_id,
            )
            sess.add(sub)
        sess.commit()

        # POST.
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json;charset=UTF-8",
            "Accept": "application/json",
        }
        wrapper = {"documentBody": body_b64, "signature": ""}
        try:
            r = requests.post(
                settings.aggregation_endpoint,
                headers=headers, data=json.dumps(wrapper),
                timeout=REQUEST_TIMEOUT,
            )
            try:
                payload = r.json()
            except ValueError:
                payload = {"text": r.text}
            doc_id = ""
            if isinstance(payload, dict):
                doc_id = str(payload.get("documentId")
                             or payload.get("document_id") or "")
            ok = r.ok and (bool(doc_id) or r.status_code < 300)
            err = "" if r.ok else f"HTTP {r.status_code}: {payload}"
            sub.http_status = r.status_code
            sub.document_id = doc_id
            sub.ok = ok
            sub.error = err
        except requests.RequestException as e:
            sub.http_status = 0
            sub.document_id = ""
            sub.ok = False
            sub.error = f"network: {e}"
        sess.commit()

        results.append({
            "report_index": idx,
            "ok": sub.ok,
            "http_status": sub.http_status,
            "document_id": sub.document_id,
            "error": sub.error or "",
            "unit_count": sub.unit_count,
            "code_count": sub.code_count,
            "sscc_list": [b.sscc for b in batch],
        })

        if idx < len(batches):
            time.sleep(sleep_secs)

    # Finalize status.
    if all(r["ok"] for r in results):
        sess.execute(_text("UPDATE projects SET status='submitted' WHERE id=:pid"),
                     {"pid": project_id})
    else:
        sess.execute(_text("UPDATE projects SET status='active' WHERE id=:pid"),
                     {"pid": project_id})
    sess.commit()

    return {"ok": all(r["ok"] for r in results),
            "reports": results,
            "total_reports": len(results)}
