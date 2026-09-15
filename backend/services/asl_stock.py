"""ASL Belgisi Business-User "MC export" client — the GTIN Ostatok flow.

Ported verbatim from pages/6_GTIN_Ostatok_Check.py + backend.py (Streamlit
app). No Streamlit deps. Same endpoints, same normalization.

Endpoints used
--------------
  GET  /public/api/v1/party/parties/tin/api-keys/check       verify (INN, apiKey)
  POST /public/api/cod/exports                                register export
  GET  /public/api/cod/exports/{id}/status                    poll status
  GET  /public/api/cod/exports/{id}/result                    download ZIP

Auth: `Authorization: Bearer <business-user API key>` — one key per company,
never persisted server-side, sent per request from the browser.
"""
from __future__ import annotations

import io
import json
import time
import zipfile
from typing import Any

import requests

from ..config import get_settings

REQUEST_TIMEOUT = 60


def _base() -> str:
    return get_settings().asl_api_base.rstrip("/")


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def _headers(api_key: str, *, accept_zip: bool = False) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/zip" if accept_zip else "application/json",
    }
    if not accept_zip:
        headers["Content-Type"] = "application/json;charset=UTF-8"
    return headers


def _handle(resp: requests.Response, context: str) -> dict:
    if resp.status_code in (200, 201):
        try:
            return {"success": True, "data": resp.json(), "http_status": resp.status_code}
        except Exception:
            return {"success": True, "data": resp.text[:500], "http_status": resp.status_code}
    return {
        "success": False,
        "error": f"[{context}] HTTP {resp.status_code}: {resp.text[:500]}",
        "http_status": resp.status_code,
    }


def extract_status_value(payload: Any) -> str:
    """Dig into common shapes {status: ..} / {data: {status: ..}} / string."""
    if isinstance(payload, dict):
        for key in ("status", "processingStatus", "documentStatus", "state"):
            v = payload.get(key)
            if v:
                return str(v)
        nested = payload.get("data")
        if nested is not None:
            return extract_status_value(nested)
    if isinstance(payload, list) and payload:
        return extract_status_value(payload[0])
    if isinstance(payload, str):
        return payload
    return ""


# ─────────────────────────────────────────────────────────────
# API calls
# ─────────────────────────────────────────────────────────────
def verify_api_key_ownership(inn: str, api_key: str) -> dict:
    """GET /public/api/v1/party/parties/{tin}/api-keys/check

    `tin` is a PATH segment, not a query parameter. We used to call
    .../parties/tin/api-keys/check?tin=<inn> — i.e. the literal word "tin"
    in the path — which always came back {"isTinCorrect": false} even for a
    key that genuinely belonged to the INN. Confirmed with ASL support.

    The response also carries the API key's expiry date.
    """
    try:
        resp = requests.get(
            f"{_base()}/public/api/v1/party/parties/{inn.strip()}/api-keys/check",
            headers=_headers(api_key),
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code in (200, 201):
            try:
                return {"success": True, "data": resp.json(), "http_status": resp.status_code}
            except Exception:
                return {"success": True, "data": {"raw": resp.text[:500]},
                        "http_status": resp.status_code}
        return {
            "success": False,
            "error": f"API kalit egaligini tekshirib bo'lmadi: HTTP {resp.status_code}: {resp.text[:300]}",
            "http_status": resp.status_code,
        }
    except requests.RequestException as e:
        return {"success": False, "error": f"tarmoq xatosi: {e}", "http_status": 0}


def fetch_mod_list(inn: str, api_key: str) -> dict:
    """GET /participants/mod — business places (MOD list) for this INN.

    Uses the /api/v2 base (not the /public/api/v1 open-API). Both are served
    by aslbelgisi.uz; the MOD list historically lives on v2. Falls back to
    xtrace.* if the v2 base doesn't answer.
    """
    urls = [
        "https://aslbelgisi.uz/api/v2/participants/mod",
        f"{_base()}/api/v2/participants/mod",
    ]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "X-INN": inn.strip(),
    }
    last: dict = {"success": False, "error": "MOD list request failed", "http_status": 0}
    for url in urls:
        try:
            resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            if resp.status_code in (200, 201):
                try:
                    data = resp.json()
                except Exception:
                    data = {"raw": resp.text[:500]}
                return {"success": True, "data": data, "http_status": resp.status_code}
            last = {"success": False,
                    "error": f"HTTP {resp.status_code}: {resp.text[:300]}",
                    "http_status": resp.status_code}
        except requests.RequestException as e:
            last = {"success": False, "error": str(e), "http_status": 0}
    return last


def register_export(api_key: str, export_filter: dict) -> dict:
    """POST /public/api/cod/exports — returns {id: ...}"""
    try:
        resp = requests.post(
            f"{_base()}/public/api/cod/exports",
            headers=_headers(api_key),
            data=json.dumps(export_filter),
            timeout=REQUEST_TIMEOUT,
        )
        return _handle(resp, "register_mc_export")
    except requests.RequestException as e:
        return {"success": False, "error": str(e), "http_status": 0}


def get_export_status(api_key: str, export_id: str) -> dict:
    try:
        resp = requests.get(
            f"{_base()}/public/api/cod/exports/{export_id}/status",
            headers=_headers(api_key),
            timeout=REQUEST_TIMEOUT,
        )
        return _handle(resp, "get_mc_export_status")
    except requests.RequestException as e:
        return {"success": False, "error": str(e), "http_status": 0}


def get_export_result(api_key: str, export_id: str) -> dict:
    """GET .../result — returns ZIP bytes with one JSON inside."""
    try:
        resp = requests.get(
            f"{_base()}/public/api/cod/exports/{export_id}/result",
            headers=_headers(api_key, accept_zip=True),
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code not in (200, 201):
            return {
                "success": False,
                "error": f"HTTP {resp.status_code}: {resp.text[:500]}",
                "http_status": resp.status_code,
            }
        parsed = parse_export_zip(resp.content)
        if not parsed["success"]:
            return {"success": False, "error": parsed["error"],
                    "http_status": resp.status_code}
        return {
            "success": True,
            "data": parsed["data"],
            "file_name": parsed["file_name"],
            "http_status": resp.status_code,
            "raw_bytes": resp.content,
        }
    except requests.RequestException as e:
        return {"success": False, "error": str(e), "http_status": 0}


def expand_transport_to_kms(api_key: str, inn: str, codes: list[str],
                             sleep_between: float = 0.15) -> dict:
    """9.3 method — POST /public/api/cod/nested-codes/owner-check.

    Given a list of TRANSPORT codes (SSCC / BOX_LV_*), unpacks each one to
    its child consumption KMs and returns a de-duped flat list, in input
    order. Codes that already look like a KM (start with '01') are kept
    as-is without a network call.

    Rate-limit sleep between calls keeps us well under ASL's 100/min cap
    even for larger boxes.
    """
    seen: set[str] = set()
    km_out: list[str] = []
    warnings: list[str] = []

    for i, raw in enumerate(codes):
        code = (raw or "").strip()
        if not code:
            continue
        # A GTIN-based KM identity starts with AI 01. Anything else is
        # treated as a transport code and unpacked via 9.3.
        if code.startswith("01") and len(code) >= 31:
            if code not in seen:
                seen.add(code); km_out.append(code)
            continue

        payload = {"codes": [code], "ownerTin": inn}
        try:
            resp = requests.post(
                f"{_base()}/public/api/cod/nested-codes/owner-check",
                headers=_headers(api_key),
                data=json.dumps(payload),
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            warnings.append(f"{code[:20]}…: {e}")
            continue

        if resp.status_code not in (200, 201):
            # Try the older shape (no ownerTin) — some accounts serve it
            try:
                resp = requests.post(
                    f"{_base()}/public/api/cod/nested-codes/owner-check",
                    headers=_headers(api_key),
                    data=json.dumps({"codes": [code]}),
                    timeout=REQUEST_TIMEOUT,
                )
            except requests.RequestException as e:
                warnings.append(f"{code[:20]}…: {e}")
                continue

        if resp.status_code not in (200, 201):
            warnings.append(f"{code[:20]}… HTTP {resp.status_code}")
            continue

        try:
            data = resp.json()
        except Exception:
            continue

        for km in _flatten_children(data):
            if km not in seen:
                seen.add(km); km_out.append(km)

        if i < len(codes) - 1 and sleep_between > 0:
            time.sleep(sleep_between)

    return {"success": True, "km_codes": km_out, "warnings": warnings}


def owner_check(api_key: str, inn: str, raw_codes: list[str]) -> dict:
    """9.3 nested-codes/owner-check — classify each code's ownership.

    Verified live (2026-09-07) against UNIT codes:
      * owned by this TIN      -> appears in results[].code
      * owned by a DIFFERENT   -> appears in forbiddenCodes[]
      * not found in ASL       -> appears in missingCodes[]
    Response shape: {results:[{code,...}], forbiddenCodes:[str], missingCodes:[str]}

    Pass the 31-char CANONICAL codes (NOT the raw DataMatrix scan): a code
    carrying the AI-91/92 crypto tail comes back as `missing`. Verdicts are
    keyed by canonical, which is also what results[] echoes back.

    Returns {"ok": bool, "owned": set, "forbidden": set, "missing": set,
             "error": str|None} where the sets hold CANONICAL codes. On any
    network/HTTP error ok=False and the caller must treat those codes as an
    unresolved TECHNICAL failure (never cache, never silently accept).
    Chunks to ASL's documented max of 100 codes per request.
    """
    from .codes import canonical_km

    owned: set[str] = set()
    forbidden: set[str] = set()
    missing: set[str] = set()

    uniq = [c for c in dict.fromkeys(x.strip() for x in raw_codes) if c]
    for i in range(0, len(uniq), 100):
        chunk = uniq[i:i + 100]
        payload = {"codes": chunk, "ownerTin": inn.strip()}
        try:
            resp = requests.post(
                f"{_base()}/public/api/cod/nested-codes/owner-check",
                headers=_headers(api_key),
                data=json.dumps(payload),
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            return {"ok": False, "owned": owned, "forbidden": forbidden,
                    "missing": missing, "error": f"tarmoq xatosi: {e}"}
        if resp.status_code not in (200, 201):
            return {"ok": False, "owned": owned, "forbidden": forbidden,
                    "missing": missing,
                    "error": f"ASL HTTP {resp.status_code}: {resp.text[:200]}"}
        try:
            data = resp.json()
        except Exception as e:
            return {"ok": False, "owned": owned, "forbidden": forbidden,
                    "missing": missing, "error": f"ASL javobi noto'g'ri: {e}"}
        top = data.get("data", data) if isinstance(data, dict) else data
        if not isinstance(top, dict):
            return {"ok": False, "owned": owned, "forbidden": forbidden,
                    "missing": missing, "error": "ASL javobi kutilmagan shakl"}
        for item in (top.get("results") or []):
            code = item.get("code") if isinstance(item, dict) else None
            if code:
                owned.add(canonical_km(code))
        for code in (top.get("forbiddenCodes") or []):
            if code:
                forbidden.add(canonical_km(code))
        for code in (top.get("missingCodes") or []):
            if code:
                missing.add(canonical_km(code))

    return {"ok": True, "owned": owned, "forbidden": forbidden,
            "missing": missing, "error": None}


def fetch_box_children(api_key: str, inn: str, sscc: str) -> dict:
    """9.3 owner-check on ONE SSCC — used by the Box-check module.

    Returns a rich payload the router turns into JSON:
      {
        ok: bool,
        verdict: 'owned' | 'forbidden' | 'missing' | 'error',
        children: list[str],          # canonical 31-char KMs, dedup + input order
        product_name: str,
        gtin: str,
        package_type: str,
        error: str | None,
        http_status: int,
      }

    ASL's owner-check reports SSCC ownership the same way it reports KM
    ownership: `results[]` = owned by this INN, `forbiddenCodes[]` = owned by
    another INN, `missingCodes[]` = not registered in ASL. Only 'owned' gets
    a children[] list — everything else is a rejection the caller must show.
    On any network / HTTP fault ok=False and verdict='error'; callers must
    treat that as a technical failure (never accept, never cache).
    """
    sscc = (sscc or "").strip()
    if not sscc:
        return {"ok": False, "verdict": "error", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": "SSCC bo'sh", "http_status": 0}

    payload = {"codes": [sscc], "ownerTin": (inn or "").strip()}
    try:
        resp = requests.post(
            f"{_base()}/public/api/cod/nested-codes/owner-check",
            headers=_headers(api_key),
            data=json.dumps(payload),
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        return {"ok": False, "verdict": "error", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": f"tarmoq xatosi: {e}", "http_status": 0}

    if resp.status_code not in (200, 201):
        return {"ok": False, "verdict": "error", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": f"ASL HTTP {resp.status_code}: {resp.text[:200]}",
                "http_status": resp.status_code}

    try:
        data = resp.json()
    except Exception as e:
        return {"ok": False, "verdict": "error", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": f"ASL javobi noto'g'ri: {e}", "http_status": resp.status_code}

    top = data.get("data", data) if isinstance(data, dict) else data
    if not isinstance(top, dict):
        return {"ok": False, "verdict": "error", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": "ASL javobi kutilmagan shakl", "http_status": resp.status_code}

    forbidden = {str(c) for c in (top.get("forbiddenCodes") or []) if c}
    missing   = {str(c) for c in (top.get("missingCodes")   or []) if c}
    if sscc in forbidden:
        return {"ok": True, "verdict": "forbidden", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": None, "http_status": resp.status_code}
    if sscc in missing:
        return {"ok": True, "verdict": "missing", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": None, "http_status": resp.status_code}

    results = top.get("results") or []
    # Find the entry that matches our SSCC (ASL sometimes returns extras).
    match = None
    for item in results:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "")
        if code == sscc or (code and sscc.endswith(code)) or (code and code.endswith(sscc)):
            match = item
            break
    if match is None and results:
        # Fall back to the first result — sometimes ASL echoes the SSCC in a
        # slightly different form (e.g. leading zeros trimmed).
        match = results[0] if isinstance(results[0], dict) else None

    if match is None:
        # No verdict at all — treat as missing so the operator sees a clean
        # rejection instead of a silent "0 children" success.
        return {"ok": True, "verdict": "missing", "children": [],
                "product_name": "", "gtin": "", "package_type": "",
                "error": None, "http_status": resp.status_code}

    children = _flatten_children({"data": match})
    # Dedup + keep input order.
    seen: set[str] = set()
    unique: list[str] = []
    for c in children:
        if c and c not in seen:
            seen.add(c); unique.append(c)

    return {
        "ok": True, "verdict": "owned", "children": unique,
        "product_name": _localized_text(match.get("productName")
                                        or match.get("product_name")
                                        or _safe_get(match, "product", "name")),
        "gtin":         str(match.get("gtin") or match.get("productGtin") or ""),
        "package_type": str(match.get("packageType") or match.get("package_type") or ""),
        "error": None, "http_status": resp.status_code,
    }


def _flatten_children(payload: Any) -> list[str]:
    """Walk the nested-codes response and pull out every UNIT-level KM.

    ASL sometimes returns child arrays under any of these keys:
      childCodes / children / nestedCodes / consumptionCodes / codes.
    """
    out: list[str] = []
    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for k in ("childCodes", "children", "nestedCodes",
                      "consumptionCodes", "codes"):
                child = node.get(k)
                if isinstance(child, list):
                    for c in child:
                        walk(c)
            # A leaf KM node — pick up the code string
            for k in ("code", "consumerCode", "consumptionCode", "cis"):
                v = node.get(k)
                if isinstance(v, str) and v.startswith("01") and len(v) >= 31:
                    out.append(v)
                    return
        elif isinstance(node, list):
            for x in node:
                walk(x)
        elif isinstance(node, str):
            if node.startswith("01") and len(node) >= 31:
                out.append(node)
    # Response shape: {"success": true, "data": {...}} usually.
    root = payload
    if isinstance(root, dict) and "data" in root:
        root = root["data"]
    walk(root)
    return out


def parse_export_zip(zip_bytes: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            json_names = [n for n in zf.namelist() if n.lower().endswith(".json")]
            if not json_names:
                return {"success": False, "error": "ZIP arxivida JSON fayl yo'q"}
            name = json_names[0]
            with zf.open(name) as fh:
                payload = json.loads(fh.read().decode("utf-8"))
            return {"success": True, "data": payload, "file_name": name}
    except Exception as e:
        return {"success": False, "error": f"ZIP ni o'qib bo'lmadi: {e}"}


# ─────────────────────────────────────────────────────────────
# Row normalization — same output shape as the Streamlit page
# ─────────────────────────────────────────────────────────────
def _localized_text(value: Any) -> str:
    if isinstance(value, dict):
        for lang in ("en", "ru", "uz"):
            text = value.get(lang, "")
            if isinstance(text, str) and text.strip():
                return text.strip()
        for text in value.values():
            if isinstance(text, str) and text.strip():
                return text.strip()
    return str(value).strip() if value not in (None, "") else ""


def _safe_get(node: Any, *path: str) -> Any:
    current = node
    for key in path:
        if not isinstance(current, dict):
            return ""
        current = current.get(key)
    if current in (None, ""):
        return ""
    return current


def _extract_results_list(payload: Any) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get("results"), list): return payload["results"]
        if isinstance(payload.get("codes"),   list): return payload["codes"]
        if isinstance(payload.get("data"),    list): return payload["data"]
        if isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("results"), list):
            return payload["data"]["results"]
    return []


def normalize_stock_rows(payload: Any) -> list[dict]:
    """ASL export payload → flat rows with the columns the UI shows."""
    rows: list[dict] = []
    for item in _extract_results_list(payload):
        if not isinstance(item, dict):
            continue
        code_data     = item.get("codeData", {})     if isinstance(item.get("codeData"), dict)     else {}
        product_data  = item.get("productData", {})  if isinstance(item.get("productData"), dict)  else {}
        package_data  = item.get("packageData", {})  if isinstance(item.get("packageData"), dict)  else {}
        marking_data  = item.get("markingData", {})  if isinstance(item.get("markingData"), dict)  else {}
        turnover_data = item.get("turnoverData", {}) if isinstance(item.get("turnoverData"), dict) else {}
        owner_info    = turnover_data.get("ownerInfo", {}) if isinstance(turnover_data.get("ownerInfo"), dict) else {}

        row = {
            "code":                     str(_safe_get(code_data, "code") or item.get("code", "")).strip(),
            "status":                   str(_safe_get(code_data, "status") or item.get("status", "")).strip(),
            "extended_status":          str(_safe_get(code_data, "extendedStatus") or item.get("extendedStatus", "")).strip(),
            "package_type":             str(_safe_get(package_data, "packageType") or item.get("packageType", "")).strip(),
            "gtin":                     str(_safe_get(product_data, "gtin") or item.get("gtin", "")).strip(),
            "product_id":               str(_safe_get(product_data, "productId") or item.get("productId", "")).strip(),
            "product_name":             _localized_text(
                product_data.get("name")
                or product_data.get("productName")
                or product_data.get("label")
                or item.get("productName", "")
            ),
            "product_series":           str(_safe_get(product_data, "productSeries") or item.get("productSeries", "")).strip(),
            "production_date":          str(_safe_get(product_data, "productionDate") or item.get("productionDate", "")).strip(),
            "expiration_date":          str(_safe_get(product_data, "expirationDate") or item.get("expirationDate", "")).strip(),
            "emission_date":            str(_safe_get(marking_data, "emissionDate") or item.get("emissionDate", "")).strip(),
            "emission_type":            str(_safe_get(marking_data, "emissionType") or item.get("emissionType", "")).strip(),
            "original_release_method":  str(_safe_get(turnover_data, "originalReleaseMethod") or item.get("originalReleaseMethod", "")).strip(),
            "owner_tin":                str(_safe_get(owner_info, "ownerTin") or item.get("ownerTin", "")).strip(),
            "owner_name":               _localized_text(owner_info.get("ownerName") or item.get("ownerName", "")),
            "owner_business_place_id":  str(_safe_get(owner_info, "ownerBusinessPlaceId") or item.get("ownerBusinessPlaceId", "")).strip(),
            "parent_code":              str(_safe_get(package_data, "parentCode") or item.get("parentCode", "")).strip(),
            "empty_package":            bool(package_data.get("emptyPackage")) if isinstance(package_data, dict) else False,
        }
        if row["code"]:
            rows.append(row)
    return rows


def match_series_locally(rows: list[dict], wanted_series: str) -> tuple[list[dict], list[str]]:
    """ASL sometimes stores productSeries with a leading space, so its
    server-side exact-match filter misses valid rows. Trim + compare locally.

    Returns (matched_rows, all_series_found_in_raw)."""
    wanted = (wanted_series or "").strip()
    if not wanted:
        return rows, []
    available = sorted({(r.get("product_series") or "").strip()
                        for r in rows if (r.get("product_series") or "").strip()})
    matched = [r for r in rows if (r.get("product_series") or "").strip() == wanted]
    return matched, available
