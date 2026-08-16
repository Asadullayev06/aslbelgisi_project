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


# ── document-status polling (per-code error reporting) ─────
# ASL accepts the POST fast but processes async. Until we poll the doc-status
# endpoint, we don't know if the aggregation actually landed or which specific
# code(s) failed. The Streamlit app did this via wait_for_document_result +
# get_document_errors + get_document_codes. Same pattern here.

DOC_POLL_TIMEOUT_SECS = 20          # per-report cap; longer than most docs need
DOC_POLL_INTERVAL_SECS = 2
TERMINAL_OK   = {"PROCESSED", "DONE", "SUCCESS", "SUCCESSFUL", "ACCEPTED"}
TERMINAL_FAIL = {"FAILED", "ERROR", "REJECTED", "DECLINED"}


def _asl_get(api_key: str, path: str) -> dict:
    settings = get_settings()
    url = f"{settings.asl_api_base.rstrip('/')}{path}"
    try:
        r = requests.get(url, headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as e:
        return {"ok": False, "http_status": 0, "error": str(e), "data": None}
    if r.status_code == 404:
        return {"ok": False, "http_status": 404, "error": "not-found-yet",
                "data": None}
    try:
        data = r.json()
    except ValueError:
        data = {"text": r.text}
    return {
        "ok": 200 <= r.status_code < 300,
        "http_status": r.status_code,
        "error": "" if 200 <= r.status_code < 300 else f"HTTP {r.status_code}: {data}",
        "data": data,
    }


def _extract_status(payload) -> str:
    if isinstance(payload, dict):
        for key in ("status", "processingStatus", "documentStatus", "state"):
            v = payload.get(key)
            if v: return str(v).strip().upper().strip('"')
        nested = payload.get("data")
        if nested is not None:
            return _extract_status(nested)
    if isinstance(payload, list) and payload:
        return _extract_status(payload[0])
    if isinstance(payload, str):
        return payload.strip().upper().strip('"')
    return ""


def _wait_for_result(api_key: str, doc_id: str) -> dict:
    """Poll /storage/docs/{id} until terminal or timeout.
    On terminal state, also fetch /storage/errors/{id} for per-code errors."""
    deadline = time.time() + DOC_POLL_TIMEOUT_SECS
    last_status = "PENDING"
    while time.time() < deadline:
        s = _asl_get(api_key, f"/public/api/v1/doc/storage/docs/{doc_id}")
        if s["ok"]:
            status_val = _extract_status(s["data"]) or "PENDING"
            last_status = status_val
            if status_val in TERMINAL_OK or status_val in TERMINAL_FAIL:
                # Fetch per-code errors (present when status is ERROR, sometimes
                # also present for accepted-with-warnings docs).
                errs = _asl_get(api_key, f"/public/api/v1/doc/storage/errors/{doc_id}")
                per_code = _summarize_doc_errors(errs.get("data"))
                return {
                    "final_status": status_val,
                    "verified_ok":  status_val in TERMINAL_OK and not per_code,
                    "code_errors":  per_code,
                    "raw_status":   s["data"],
                    "raw_errors":   errs.get("data") if errs.get("ok") else None,
                }
        elif s["http_status"] and s["http_status"] not in (404,):
            # Non-404 error — give up rather than hammer.
            return {
                "final_status": "STATUS_FETCH_FAILED",
                "verified_ok": False,
                "code_errors": [],
                "raw_status": {"error": s["error"]},
                "raw_errors": None,
            }
        time.sleep(DOC_POLL_INTERVAL_SECS)

    return {
        "final_status": last_status,
        "verified_ok": False,
        "code_errors": [],
        "raw_status": None,
        "raw_errors": None,
        "timed_out": True,
    }


def _summarize_doc_errors(payload) -> list[dict]:
    """Normalize the /storage/errors response into a list of
       {code, error_code, index, tags} for the UI to render."""
    if payload is None:
        return []
    # Common shapes: {documentErrors: [...]}, or [{...}, ...]
    if isinstance(payload, dict):
        for key in ("documentErrors", "errors", "codes", "data"):
            v = payload.get(key)
            if isinstance(v, list):
                payload = v
                break
        else:
            return []
    if not isinstance(payload, list):
        return []
    out = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        out.append({
            "code":       str(item.get("code") or item.get("propertyValue") or ""),
            "error_code": str(item.get("errorCode") or item.get("code_error") or ""),
            "index":      item.get("index"),
            "property":   str(item.get("propertyName") or ""),
            "tags":       item.get("errorTags") or {},
        })
    return out


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

        # Poll for the processing result so we can surface per-code errors,
        # not just "HTTP 200". If POST itself failed, or no documentId came
        # back, skip polling.
        verify = {
            "final_status": "" if r["ok"] else "POST_FAILED",
            "verified_ok": r["ok"],
            "code_errors": [],
            "timed_out": False,
        }
        if r["ok"] and r["document_id"]:
            v = _wait_for_result(api_key, r["document_id"])
            verify.update(v)

        # Overall report "ok" now means: POST accepted AND doc verified
        # (or, if the doc is still processing at timeout, we mark it
        # 'unverified' but not hard-fail so operator can recheck later).
        overall_ok = r["ok"] and verify.get("verified_ok", False)
        display_error = r["error"] or ""
        if r["ok"] and not verify.get("verified_ok"):
            if verify.get("timed_out"):
                display_error = (f"Yuborildi (documentId={r['document_id']}) ammo "
                                 f"tekshirish {DOC_POLL_TIMEOUT_SECS}s ichida "
                                 "yakunlanmadi — keyinroq qayta tekshiring.")
            elif verify.get("final_status") in TERMINAL_FAIL:
                display_error = (f"ASL {verify['final_status']} bilan qaytardi. "
                                 f"Xatolar quyida — {len(verify['code_errors'])} ta kod.")
            elif verify.get("code_errors"):
                display_error = f"Qabul qilindi, lekin {len(verify['code_errors'])} ta kod xato bilan."

        reports_out.append({
            "report_index":     idx,
            "unit_count":       len(batch),
            "code_count":       sum(len(u["codes"]) for u in batch),
            "sscc_list":        [u["sscc"] for u in batch],
            "group_indices":    [u["group_index"] for u in batch],
            "ok":               overall_ok,
            "http_status":      r["http_status"],
            "document_id":      r["document_id"],
            "error":            display_error,
            "verification_status": verify.get("final_status", ""),
            "code_errors":      verify.get("code_errors", []),
            "timed_out":        verify.get("timed_out", False),
        })
        if idx < len(batches):
            time.sleep(RATE_LIMIT_SLEEP_SECS)

    all_ok = all(r["ok"] for r in reports_out)
    return {"ok": all_ok, "mode": "submit", "errors": [],
            "groups": groups_meta, "reports": reports_out,
            "total_reports": len(reports_out)}
