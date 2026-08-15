"""GTIN Ostatok — 4 endpoints wrapping the ASL MC-export flow.

Any authenticated user can use this; the ASL Bearer key is sent per request
from the browser and NEVER stored server-side. It's ASL that decides which
stock the caller can see (based on the API key's owner).
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..auth import current_user
from ..models import User
from ..services import asl_stock

router = APIRouter(prefix="/api/gtin-stock", tags=["gtin-stock"])


# ── request models ─────────────────────────────────────────
class VerifyBody(BaseModel):
    inn: str = Field(min_length=1)
    api_key: str = Field(min_length=1)


class RegisterBody(BaseModel):
    inn: str = Field(min_length=1)
    api_key: str = Field(min_length=1)
    gtin: str = Field(min_length=1)
    package_types: list[str] = []
    statuses: list[str] = []
    emission_types: list[str] = []
    release_methods: list[str] = []
    product_series: str = ""


class ResultBody(BaseModel):
    api_key: str = Field(min_length=1)
    product_series: str = ""


# ── response models ────────────────────────────────────────
class VerifyOut(BaseModel):
    ok: bool
    inn: str
    detail: dict | str | None = None
    error: str | None = None


class RegisterOut(BaseModel):
    ok: bool
    export_id: str = ""
    error: str = ""


class StatusOut(BaseModel):
    ok: bool
    export_id: str
    status: str
    ready: bool
    error: str = ""


class StockRow(BaseModel):
    code: str
    status: str
    extended_status: str = ""
    package_type: str = ""
    gtin: str = ""
    product_id: str = ""
    product_name: str = ""
    product_series: str = ""
    production_date: str = ""
    expiration_date: str = ""
    emission_date: str = ""
    emission_type: str = ""
    original_release_method: str = ""
    owner_tin: str = ""
    owner_name: str = ""
    owner_business_place_id: str = ""
    parent_code: str = ""
    empty_package: bool = False


class ResultOut(BaseModel):
    ok: bool
    export_id: str = ""
    row_count: int = 0
    raw_result_count: int = 0
    rows: list[StockRow] = []
    available_series: list[str] = []
    zip_b64: str = ""
    zip_filename: str = ""
    fetched_at: str = ""
    error: str = ""


# ── endpoints ──────────────────────────────────────────────
@router.post("/verify", response_model=VerifyOut)
def verify(body: VerifyBody, _u: User = Depends(current_user)):
    res = asl_stock.verify_api_key_ownership(body.inn.strip(), body.api_key.strip())
    if res.get("success"):
        return VerifyOut(ok=True, inn=body.inn.strip(), detail=res.get("data"))
    return VerifyOut(ok=False, inn=body.inn.strip(), error=res.get("error", "verify failed"))


@router.post("/register", response_model=RegisterOut)
def register(body: RegisterBody, _u: User = Depends(current_user)):
    """Register an ASL export. Returns the export_id to poll.

    Deliberately DOES NOT include date filters — same as the current page 7
    port scope: `gtin` is the primary key, other filters narrow the shape.
    """
    if not body.gtin.strip().isdigit():
        raise HTTPException(400, "GTIN faqat raqamlardan iborat bo'lishi kerak")

    payload: dict = {"gtin": body.gtin.strip()}
    if body.package_types:   payload["packageType"]            = body.package_types
    if body.statuses:        payload["status"]                 = body.statuses
    if body.emission_types:  payload["emissionType"]           = body.emission_types
    if body.release_methods: payload["originalReleaseMethod"]  = body.release_methods
    if body.product_series.strip():
        payload["productSeries"] = body.product_series.strip()

    res = asl_stock.register_export(body.api_key.strip(), payload)
    if not res.get("success"):
        return RegisterOut(ok=False, error=res.get("error", "register failed"))
    export_id = str((res.get("data") or {}).get("id", "")).strip()
    if not export_id:
        return RegisterOut(ok=False, error="ASL export ID qaytmadi")
    return RegisterOut(ok=True, export_id=export_id)


@router.get("/exports/{export_id}/status", response_model=StatusOut)
def status(export_id: str, api_key: str, _u: User = Depends(current_user)):
    res = asl_stock.get_export_status(api_key.strip(), export_id)
    if not res.get("success"):
        return StatusOut(ok=False, export_id=export_id, status="",
                         ready=False, error=res.get("error", "status failed"))
    status_value = asl_stock.extract_status_value(res.get("data")).strip().upper().strip('"')
    if not status_value and isinstance(res.get("data"), str):
        status_value = res["data"].strip().upper().strip('"')
    return StatusOut(
        ok=True,
        export_id=export_id,
        status=status_value or "CREATED",
        ready=(status_value == "SUCCESS"),
    )


@router.post("/exports/{export_id}/result", response_model=ResultOut)
def result(export_id: str, body: ResultBody, _u: User = Depends(current_user)):
    res = asl_stock.get_export_result(body.api_key.strip(), export_id)
    if not res.get("success"):
        return ResultOut(ok=False, export_id=export_id, error=res.get("error", "result failed"))

    raw_payload = res.get("data") or {}
    rows = asl_stock.normalize_stock_rows(raw_payload)
    raw_count = len(asl_stock._extract_results_list(raw_payload))

    available: list[str] = []
    if body.product_series.strip():
        rows, available = asl_stock.match_series_locally(rows, body.product_series)

    zip_bytes: bytes = res.get("raw_bytes") or b""
    return ResultOut(
        ok=True,
        export_id=export_id,
        row_count=len(rows),
        raw_result_count=raw_count,
        rows=[StockRow(**r) for r in rows],
        available_series=available,
        zip_b64=base64.b64encode(zip_bytes).decode("ascii") if zip_bytes else "",
        zip_filename=res.get("file_name", f"asl_stock_export_{export_id}.zip"),
        fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
