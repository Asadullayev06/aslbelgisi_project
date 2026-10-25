"""Asl Belgisi / TracePro — MCP server for external AI agents (Hermes).

Exposes a small, READ-ONLY set of tools over MCP so an agent can answer
questions like "how much of this GTIN is left?" and "who owns this KM code?".
It never exposes any write/operational action (no scanning, no submits to
ASL, no user/project management).

Design
------
* Credentials are resolved LIVE from the platform's own company module — the
  `asl_companies` table (the same rows the web UI's CompanyPicker manages).
  When an admin changes a company's INN/API key there, this server picks up
  the new value on the very next call. Nothing is cached.
* It reuses the platform's battle-tested ASL client (`backend.services.*`),
  so behaviour matches the web app exactly.
* Transport is SSE over HTTP (like the Telegram MCP), guarded by a bearer
  token so only Hermes can call it.

Run
---
    # from mass_aggregation_v2/
    export DATABASE_URL=...            # same Neon DB as the web app
    export ASL_API_BASE=https://aslbelgisi.uz   # (backend.config default)
    export MCP_AUTH_TOKEN=<long-random-secret>  # Hermes sends this as Bearer
    export MCP_PORT=8900
    python -m mcp_server.server

Hermes connects to  https://<public-host>/sse  with header
`Authorization: Bearer <MCP_AUTH_TOKEN>`.
"""
from __future__ import annotations

import os
import time
from collections import Counter
from typing import Any, Optional

import anyio
from mcp.server.fastmcp import FastMCP
from sqlalchemy import select

from backend.db import session_scope
from backend.models import AslCompany
from backend.services import asl_inspector, asl_stock
from backend.services.codes import normalize_sscc
from backend.services.search import search_codes

mcp = FastMCP("tracepro-asl")


# ───────────────────────── credential resolution ─────────────────────────
class CompanyError(Exception):
    """Raised when a company name/INN can't be resolved to stored credentials."""


def _resolve_company(company: str) -> tuple[str, str, str]:
    """Look up (inn, api_key, name) for a saved company by NAME or INN.

    Reads the `asl_companies` table live, so a credential change in the web UI
    is reflected immediately. Matching is case-insensitive on name, exact on
    INN.  Raises CompanyError (with the list of valid names) when not found.
    """
    key = (company or "").strip()
    if not key:
        raise CompanyError("Kompaniya nomi yoki INN ko'rsatilmagan")
    with session_scope() as sess:
        rows = list(sess.execute(select(AslCompany)).scalars())
        for c in rows:
            if c.inn and c.inn.strip() == key:
                return c.inn.strip(), c.api_key.strip(), c.name
        low = key.lower()
        for c in rows:
            if c.name and c.name.strip().lower() == low:
                return c.inn.strip(), c.api_key.strip(), c.name
        names = ", ".join(sorted(c.name for c in rows)) or "(bo'sh)"
        raise CompanyError(
            f"'{company}' kompaniyasi topilmadi. Mavjud kompaniyalar: {names}")


async def _in_thread(fn, *args):
    """Run a blocking (requests-based) service call off the event loop."""
    return await anyio.to_thread.run_sync(fn, *args)


# ───────────────────────────── tools ─────────────────────────────────────
@mcp.tool()
async def list_companies() -> dict:
    """List the saved companies you can query (name + INN only, never the API
    key). Use one of these names (or its INN) as the `company` argument for the
    other tools."""
    def _impl() -> dict:
        with session_scope() as sess:
            rows = list(sess.execute(
                select(AslCompany).order_by(AslCompany.name.asc())).scalars())
            return {"companies": [{"name": c.name, "inn": c.inn} for c in rows]}
    return await _in_thread(_impl)


@mcp.tool()
async def gtin_ostatok(
    company: str,
    gtin: str,
    product_series: str = "",
    statuses: Optional[list[str]] = None,
    package_types: Optional[list[str]] = None,
    emission_date_from: str = "",
    emission_date_to: str = "",
) -> dict:
    """How much of a product (by GTIN) remains — the "ostatok" check.

    Registers an ASL export for the GTIN, waits for it, and returns a compact
    summary: product name, total codes, breakdown by status / owner / series /
    package type, and a small sample of codes.

    Args:
      company: saved company name or INN (see list_companies).
      gtin: 14-digit GTIN (digits only; a leading zero is required).
      product_series: optional batch/series filter.
      statuses: optional status filter list.
      package_types: optional package-type filter list.
      emission_date_from / emission_date_to: optional YYYY-MM-DD window.

    Note: ASL caps an export at ~10 MB with no pagination. For very large GTINs
    the export returns ERROR — narrow it with product_series or a date window.
    """
    def _impl() -> dict:
        try:
            inn, api_key, cname = _resolve_company(company)
        except CompanyError as e:
            return {"ok": False, "error": str(e)}

        g = gtin.strip()
        if not g.isdigit():
            return {"ok": False, "error": "GTIN faqat raqamlardan iborat bo'lishi kerak"}

        payload: dict[str, Any] = {"gtin": g}
        if package_types:   payload["packageType"]           = package_types
        if statuses:        payload["status"]                = statuses
        if product_series.strip(): payload["productSeries"]  = product_series.strip()
        if emission_date_from.strip():
            payload["emissionDateFrom"] = f"{emission_date_from.strip()}T00:00:00Z"
        if emission_date_to.strip():
            payload["emissionDateTo"] = f"{emission_date_to.strip()}T23:59:59Z"

        reg = asl_stock.register_export(api_key, payload)
        if not reg.get("success"):
            return {"ok": False, "error": reg.get("error", "export register failed")}
        export_id = str((reg.get("data") or {}).get("id", "")).strip()
        if not export_id:
            return {"ok": False, "error": "ASL export ID qaytmadi"}

        # Poll until ready (cap ~90s so we never hang past a proxy timeout).
        status_value = ""
        for _ in range(36):
            st = asl_stock.get_export_status(api_key, export_id)
            if st.get("success"):
                status_value = asl_stock.extract_status_value(st.get("data")).strip().upper().strip('"')
                if status_value in ("SUCCESS", "ERROR"):
                    break
            time.sleep(2.5)

        if status_value == "ERROR":
            return {"ok": False, "status": "ERROR", "export_id": export_id,
                    "error": "Export juda katta (ASL 10MB cheklovi). Seriya yoki "
                             "sana oralig'i bilan toraytiring."}
        if status_value != "SUCCESS":
            return {"ok": False, "status": status_value or "PENDING", "export_id": export_id,
                    "error": "Export hali tayyor emas — toraytirilgan filtr bilan qayta urining."}

        res = asl_stock.get_export_result(api_key, export_id)
        if not res.get("success"):
            return {"ok": False, "error": res.get("error", "result fetch failed")}
        rows = asl_stock.normalize_stock_rows(res.get("data") or {})
        if product_series.strip():
            rows, _avail = asl_stock.match_series_locally(rows, product_series)

        by_status = Counter(r.get("status", "") for r in rows)
        by_series = Counter(r.get("product_series", "") for r in rows)
        by_pkg    = Counter(r.get("package_type", "") for r in rows)
        owners    = Counter((r.get("owner_tin", ""), r.get("owner_name", "")) for r in rows)
        product   = next((r.get("product_name", "") for r in rows if r.get("product_name")), "")

        return {
            "ok": True,
            "company": cname,
            "gtin": g,
            "product_name": product,
            "total_codes": len(rows),
            "by_status": dict(by_status),
            "by_series": dict(by_series),
            "by_package_type": dict(by_pkg),
            "by_owner": [{"tin": t, "name": n, "count": c} for (t, n), c in owners.most_common()],
            "codes_sample": [r.get("code", "") for r in rows[:20]],
        }
    return await _in_thread(_impl)


@mcp.tool()
async def km_info(company: str, codes: list[str]) -> dict:
    """Full details for one or more KM (marking) codes: current owner, product,
    status, aggregation (which box), emission/expiry, and provenance summary.

    Args:
      company: saved company name or INN.
      codes: up to 50 KM codes.
    """
    def _impl() -> dict:
        try:
            inn, api_key, cname = _resolve_company(company)
        except CompanyError as e:
            return {"ok": False, "error": str(e)}
        clean = [c.strip() for c in codes if c and c.strip()][:50]
        if not clean:
            return {"ok": False, "error": "Kamida bitta KM kod kiriting"}

        results = asl_inspector.service().lookup_batch(api_key, inn, clean)
        out = []
        for r in results:
            out.append({
                "code": r.basic.code or "",
                "found": r.success,
                "status": r.basic.status,
                "status_label": r.basic.status_label,
                "product_name": r.basic.product_name,
                "gtin": r.basic.gtin,
                "batch": r.basic.batch,
                "production_date": r.basic.production_date,
                "expiration_date": r.basic.expiration_date,
                "owner_inn": r.owner.owner_inn,
                "owner_name": r.owner.owner_name,
                "is_aggregated": r.aggregation.is_aggregated,
                "parent_code": r.aggregation.parent_code,
                "emission_date": asl_inspector.pick_emission_date(r),
                "summary_owner": asl_inspector.summary_owner(r),
                "summary_product": asl_inspector.summary_product(r),
                "error": r.error,
            })
        return {"ok": True, "company": cname, "total": len(out),
                "found": sum(1 for x in out if x["found"]), "results": out}
    return await _in_thread(_impl)


@mcp.tool()
async def km_owner(company: str, code: str) -> dict:
    """Quick lookup — just the CURRENT OWNER (INN + name), product and status
    of a single KM code. Lighter/faster than km_info.

    Args:
      company: saved company name or INN.
      code: one KM code.
    """
    def _impl() -> dict:
        try:
            inn, api_key, cname = _resolve_company(company)
        except CompanyError as e:
            return {"ok": False, "error": str(e)}
        c = (code or "").strip()
        if not c:
            return {"ok": False, "error": "KM kod kiriting"}
        results = asl_inspector.service().lookup_batch(api_key, inn, [c])
        if not results:
            return {"ok": False, "error": "natija yo'q"}
        r = results[0]
        return {
            "ok": r.success,
            "company": cname,
            "code": r.basic.code or c,
            "owner_inn": r.owner.owner_inn,
            "owner_name": r.owner.owner_name,
            "product_name": r.basic.product_name,
            "status": r.basic.status,
            "status_label": r.basic.status_label,
            "error": r.error or None,
        }
    return await _in_thread(_impl)


@mcp.tool()
async def sscc_contents(company: str, sscc: str) -> dict:
    """List the child KM codes inside a box (SSCC) according to ASL, and verify
    the box belongs to the company.

    Args:
      company: saved company name or INN.
      sscc: the box code (18 or 20 digits).

    Returns verdict = owned | forbidden | missing, plus the child KM list.
    """
    def _impl() -> dict:
        try:
            inn, api_key, cname = _resolve_company(company)
        except CompanyError as e:
            return {"ok": False, "error": str(e)}
        raw = (sscc or "").strip()
        try:
            canonical = normalize_sscc(raw)
        except ValueError:
            canonical = raw
        resp = asl_stock.fetch_box_children(api_key=api_key, inn=inn, sscc=canonical)
        verdict = resp.get("verdict")
        children = list(resp.get("children") or [])
        return {
            "ok": resp.get("ok", False) and verdict == "owned",
            "company": cname,
            "sscc": canonical,
            "verdict": verdict,
            "child_count": len(children),
            "children": children[:500],
            "product_name": resp.get("product_name", ""),
            "gtin": resp.get("gtin", ""),
            "error": resp.get("error"),
        }
    return await _in_thread(_impl)


@mcp.tool()
async def mod_list(company: str) -> dict:
    """List the company's MOD / business-place entries registered in ASL
    (reference data for aggregation).

    Args:
      company: saved company name or INN.
    """
    def _impl() -> dict:
        try:
            inn, api_key, cname = _resolve_company(company)
        except CompanyError as e:
            return {"ok": False, "error": str(e)}
        res = asl_stock.fetch_mod_list(inn, api_key)
        if not res.get("success"):
            return {"ok": False, "error": res.get("error", "MOD list failed")}
        data = res.get("data")
        items = data if isinstance(data, list) else (data or {}).get("result") or []
        return {"ok": True, "company": cname, "mods": items}
    return await _in_thread(_impl)


@mcp.tool()
async def code_search(codes: list[str]) -> dict:
    """Locate codes inside the company's OWN aggregation records (the internal
    database of submitted projects) — which box/project a KM is in, or what a
    box (SSCC) contains. This is internal data, not a live ASL query, and needs
    no company argument.

    Args:
      codes: up to 200 KM or SSCC codes.
    """
    def _impl() -> dict:
        clean = [c.strip() for c in codes if c and c.strip()][:200]
        if not clean:
            return {"ok": False, "error": "Kamida bitta kod kiriting"}
        with session_scope() as sess:
            results = search_codes(sess, clean)
        found = sum(1 for r in results if r.get("found"))
        return {"ok": True, "total": len(results), "found": found, "results": results}
    return await _in_thread(_impl)


# ─────────────────────────── HTTP (SSE) + auth ───────────────────────────
def _build_app():
    """SSE app guarded by a bearer token (set MCP_AUTH_TOKEN)."""
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse

    token = os.environ.get("MCP_AUTH_TOKEN", "").strip()

    class AuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            if request.url.path in ("/health", "/"):
                return await call_next(request)
            if token:
                auth = request.headers.get("authorization", "")
                presented = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
                if presented != token:
                    return JSONResponse({"detail": "unauthorized"}, status_code=401)
            return await call_next(request)

    app = mcp.sse_app()
    app.add_middleware(AuthMiddleware)

    async def health(_req):
        return JSONResponse({"ok": True, "service": "tracepro-asl-mcp"})
    app.add_route("/health", health, methods=["GET"])
    return app


def main() -> None:
    import uvicorn
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    port = int(os.environ.get("MCP_PORT", "8900"))
    if not os.environ.get("MCP_AUTH_TOKEN", "").strip():
        print("WARNING: MCP_AUTH_TOKEN is not set — the server is UNAUTHENTICATED.")
    uvicorn.run(_build_app(), host=host, port=port)


if __name__ == "__main__":
    main()
