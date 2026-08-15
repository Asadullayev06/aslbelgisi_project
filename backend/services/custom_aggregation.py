"""Custom Aggregation — one-shot bulk mass aggregation to ASL Belgisi.

You give us:
  * KM codes (already validated + reduced to identity form)
  * group_size (KM per box, ≤1000 per §1.4 aggregation-unit cap)
  * SSCC source — auto-generate from INN/GCP, or an uploaded list
  * businessPlaceId (MOD)
  * optional productionOrderId
  * mode: "dry_run" | "submit"

We return:
  * per-group SSCC + status
  * per-report POST results (in submit mode)

Reuses the same POST shape and per-report caps that asl_client.submit_project
uses, but the boxes come from the request instead of the DB — nothing gets
persisted (custom aggregation is stateless by design).
"""
from __future__ import annotations

import base64
import json
import time
from datetime import datetime, timezone
from typing import Iterable

import requests

from ..config import get_settings
from .csv_parser import chunk_codes
from .sscc_generator import SSCCGenerator

# Same caps used everywhere else — from ASL Open API v1.35 §1.4.
MAX_CODES_PER_REPORT = 30_000
MAX_GROUP_UNITS_PER_REPORT = 200
MAX_CODES_PER_AGGREGATION_UNIT = 1_000
REQUEST_TIMEOUT = 60
RATE_LIMIT_SLEEP_SECS = 0.7


# ─────────────────────────────────────────────────────────────
# Group planning (before submit)
# ─────────────────────────────────────────────────────────────
def plan_groups(
    codes: list[str],
    group_size: int,
    sscc_source: str,               # "auto" | "upload"
    sscc_inn: str = "",
    sscc_use_gcp: bool = False,
    sscc_gcp_prefix: str = "",
    sscc_start: int = 1,
    sscc_uploaded: list[str] | None = None,
) -> dict:
    """Split codes into groups, assign SSCCs. Pure — no network.
    Returns {ok, groups[{index, sscc, codes_count}], errors[]}."""
    errors: list[str] = []
    if not codes:
        errors.append("KM ro'yxati bo'sh")
    if group_size < 1 or group_size > MAX_CODES_PER_AGGREGATION_UNIT:
        errors.append(f"group_size 1-{MAX_CODES_PER_AGGREGATION_UNIT} oralig'ida bo'lishi kerak")
    if errors:
        return {"ok": False, "errors": errors, "groups": []}

    try:
        groups_of_codes = chunk_codes(codes, group_size)
    except ValueError as e:
        return {"ok": False, "errors": [str(e)], "groups": []}
    n_groups = len(groups_of_codes)

    sscc_list: list[str] = []

    if sscc_source == "auto":
        try:
            gen = SSCCGenerator.from_inn(
                inn=sscc_inn,
                use_gcp=sscc_use_gcp,
                gcp_prefix=sscc_gcp_prefix,
            )
        except ValueError as e:
            return {"ok": False, "errors": [f"SSCC generator: {e}"], "groups": []}
        try:
            for i in range(n_groups):
                r = gen.generate(sscc_start + i)
                sscc_list.append(SSCCGenerator.to_parent_package_code(r.sscc))
        except ValueError as e:
            return {"ok": False, "errors": [f"SSCC generation: {e}"], "groups": []}
    else:
        pool = list(sscc_uploaded or [])
        if len(pool) < n_groups:
            return {"ok": False,
                    "errors": [f"Yuklangan SSCC yetarli emas: {len(pool)} berildi, "
                               f"{n_groups} kerak"],
                    "groups": []}
        # Take the first n and normalize.
        for i in range(n_groups):
            try:
                sscc_list.append(SSCCGenerator.to_parent_package_code(pool[i]))
            except ValueError as e:
                return {"ok": False, "errors": [f"Uploaded SSCC #{i+1}: {e}"], "groups": []}

    groups = [
        {"index": i + 1, "sscc": sscc_list[i], "codes_count": len(groups_of_codes[i])}
        for i in range(n_groups)
    ]
    return {"ok": True, "errors": [], "groups": groups,
            "groups_of_codes": groups_of_codes, "sscc_list": sscc_list}


# ─────────────────────────────────────────────────────────────
# Report batching + POST
# ─────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _batch(groups_of_codes: list[list[str]], sscc_list: list[str],
           max_units: int = MAX_GROUP_UNITS_PER_REPORT,
           max_codes: int = MAX_CODES_PER_REPORT,
           ) -> list[list[dict]]:
    """Split (SSCC, codes) pairs into report batches respecting caps."""
    reports: list[list[dict]] = []
    cur: list[dict] = []
    cur_codes = 0
    for i, (codes, sscc) in enumerate(zip(groups_of_codes, sscc_list)):
        n = len(codes)
        if cur and (len(cur) >= max_units or cur_codes + n > max_codes):
            reports.append(cur)
            cur, cur_codes = [], 0
        cur.append({
            "group_index": i + 1,
            "sscc": sscc,
            "codes": codes,
            "capacity": len(codes),   # custom: capacity == actual (spec allows)
        })
        cur_codes += n
    if cur:
        reports.append(cur)
    return reports


def _build_body(units: list[dict], business_place_id: str,
                production_order_id: str = "") -> str:
    """Base64-encode the inner document JSON."""
    bp = str(business_place_id).strip()
    bp_val: int | str = int(bp) if bp.isdigit() else bp
    inner = {
        "aggregationUnits": [{
            "aggregationItemsCount": len(u["codes"]),
            "aggregationUnitCapacity": int(u["capacity"]),
            "codes": list(u["codes"]),
            "unitSerialNumber": u["sscc"],
        } for u in units],
        "businessPlaceId": bp_val,
        "documentDate": _now_iso(),
    }
    if production_order_id.strip():
        inner["productionOrderId"] = production_order_id.strip()
    body = json.dumps(inner, ensure_ascii=False,
                      separators=(",", ":"), sort_keys=True)
    return base64.b64encode(body.encode("utf-8")).decode("utf-8")


def _post_one(api_key: str, wrapper: dict) -> dict:
    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json",
    }
    try:
        r = requests.post(
            f"{settings.asl_api_base.rstrip('/')}/public/api/v1/doc/aggregation",
            headers=headers, data=json.dumps(wrapper), timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        return {"ok": False, "http_status": 0, "document_id": "",
                "error": f"network: {e}", "raw": None}
    try:
        payload = r.json()
    except ValueError:
        payload = {"text": r.text}
    doc_id = ""
    if isinstance(payload, dict):
        doc_id = str(payload.get("documentId") or payload.get("document_id") or "")
    return {
        "ok": r.ok and (bool(doc_id) or r.status_code < 300),
        "http_status": r.status_code,
        "document_id": doc_id,
        "error": "" if r.ok else f"HTTP {r.status_code}: {payload}",
        "raw": payload,
    }


# ─────────────────────────────────────────────────────────────
# Main entry
# ─────────────────────────────────────────────────────────────
def run(
    *,
    api_key: str,
    codes: list[str],
    group_size: int,
    business_place_id: str,
    production_order_id: str = "",
    sscc_source: str = "auto",
    sscc_inn: str = "",
    sscc_use_gcp: bool = False,
    sscc_gcp_prefix: str = "",
    sscc_start: int = 1,
    sscc_uploaded: list[str] | None = None,
    mode: str = "dry_run",           # "dry_run" | "submit"
) -> dict:
    plan = plan_groups(
        codes=codes, group_size=group_size, sscc_source=sscc_source,
        sscc_inn=sscc_inn, sscc_use_gcp=sscc_use_gcp,
        sscc_gcp_prefix=sscc_gcp_prefix, sscc_start=sscc_start,
        sscc_uploaded=sscc_uploaded,
    )
    if not plan["ok"]:
        return {"ok": False, "mode": mode, "errors": plan["errors"],
                "groups": [], "reports": []}

    groups_meta = plan["groups"]                       # for the UI
    groups_of_codes = plan["groups_of_codes"]
    sscc_list = plan["sscc_list"]

    if mode == "dry_run":
        return {"ok": True, "mode": "dry_run", "errors": [],
                "groups": groups_meta, "reports": []}

    # Live submit.
    if not business_place_id.strip():
        return {"ok": False, "mode": "submit",
                "errors": ["businessPlaceId (MOD) berilmagan"],
                "groups": groups_meta, "reports": []}
    if not api_key.strip():
        return {"ok": False, "mode": "submit",
                "errors": ["API kaliti berilmagan"],
                "groups": groups_meta, "reports": []}

    batches = _batch(groups_of_codes, sscc_list)
    reports_out: list[dict] = []
    for idx, batch in enumerate(batches, start=1):
        body_b64 = _build_body(batch, business_place_id, production_order_id)
        wrapper = {"documentBody": body_b64, "signature": ""}
        r = _post_one(api_key, wrapper)
        reports_out.append({
            "report_index": idx,
            "unit_count": len(batch),
            "code_count": sum(len(u["codes"]) for u in batch),
            "sscc_list": [u["sscc"] for u in batch],
            "group_indices": [u["group_index"] for u in batch],
            "ok": r["ok"],
            "http_status": r["http_status"],
            "document_id": r["document_id"],
            "error": r["error"] or "",
        })
        if idx < len(batches):
            time.sleep(RATE_LIMIT_SLEEP_SECS)

    all_ok = all(r["ok"] for r in reports_out)
    return {"ok": all_ok, "mode": "submit", "errors": [],
            "groups": groups_meta, "reports": reports_out,
            "total_reports": len(reports_out)}
