"""Marking-code inspector endpoint. Bulk lookup, returns full normalized
result per code plus a summary. Auth: any logged-in user."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import current_user
from ..models import User
from ..services import asl_inspector

router = APIRouter(prefix="/api/inspector", tags=["inspector"])

# Guard against runaway payloads.
MAX_CODES_PER_REQUEST = 100


# ── in ─────────────────────────────────────────────────────
class LookupBody(BaseModel):
    inn: str = Field(min_length=1)
    api_key: str = Field(min_length=1)
    codes: list[str] = Field(default_factory=list)


# ── out (mirrors dataclasses) ──────────────────────────────
class BasicOut(BaseModel):
    code: str = ""; status: str = ""; status_label: str = ""
    gtin: str = ""; product_name: str = ""
    product_group: str = ""; product_group_name: str = ""
    tnved_code: str = ""; tnved_name: str = ""
    serial_number: str = ""; batch: str = ""
    production_date: str = ""; expiration_date: str = ""
    mrp: str = ""; package_type: str = ""

class OwnerOut(BaseModel):
    owner_inn: str = ""; owner_name: str = ""; owner_address: str = ""
    emitter_inn: str = ""; emitter_name: str = ""; emitter_address: str = ""
    manufacturer_inn: str = ""; manufacturer_name: str = ""; manufacturer_country: str = ""
    importer_inn: str = ""; importer_name: str = ""

class AggregationOut(BaseModel):
    parent_code: str = ""; parent_type: str = ""
    child_codes: list = Field(default_factory=list)
    aggregation_date: str = ""; aggregation_document_id: str = ""
    hierarchy_level: str = ""; is_aggregated: bool = False

class DocumentOut(BaseModel):
    document_id: str = ""; document_type: str = ""; document_status: str = ""
    document_date: str = ""
    sender_inn: str = ""; sender_name: str = ""
    receiver_inn: str = ""; receiver_name: str = ""
    description: str = ""

class CustomsOut(BaseModel):
    aic_code: str = ""; customs_declaration: str = ""; customs_date: str = ""
    country_of_origin: str = ""; customs_status: str = ""

class ResultOut(BaseModel):
    success: bool
    error: str = ""
    http_status: int = 0
    is_html: bool = False
    basic: BasicOut
    owner: OwnerOut
    aggregation: AggregationOut
    documents: list[DocumentOut] = Field(default_factory=list)
    customs: CustomsOut
    raw_response: dict | list | None = None
    # Convenience for the compact row (front-end derives these too but sending
    # them saves parsing effort).
    emission_date: str = ""
    summary_owner: str = ""
    summary_product: str = ""

class LookupResponse(BaseModel):
    ok: bool
    total: int
    successful: int
    failed: int
    results: list[ResultOut] = Field(default_factory=list)


def _to_result_out(r: asl_inspector.LookupResult) -> ResultOut:
    d = asdict(r)
    # documents field is list of DocumentInfo → asdict already flattens it
    raw = d.pop("raw_response", None)
    d["raw_response"] = raw
    d["emission_date"]   = asl_inspector.pick_emission_date(r)
    d["summary_owner"]   = asl_inspector.summary_owner(r)
    d["summary_product"] = asl_inspector.summary_product(r)
    return ResultOut(**d)


@router.post("/lookup", response_model=LookupResponse)
def lookup(body: LookupBody, _u: User = Depends(current_user)) -> LookupResponse:
    codes = [c.strip() for c in body.codes if c and c.strip()]
    if not codes:
        raise HTTPException(400, "kamida bitta kod kiriting")
    if len(codes) > MAX_CODES_PER_REQUEST:
        raise HTTPException(400,
            f"bir so'rovda maksimum {MAX_CODES_PER_REQUEST} ta kod (siz {len(codes)} ta yubordingiz)")

    results = asl_inspector.service().lookup_batch(
        body.api_key.strip(), body.inn.strip(), codes,
    )
    out = [_to_result_out(r) for r in results]
    ok = sum(1 for r in out if r.success)
    return LookupResponse(
        ok=True, total=len(out),
        successful=ok, failed=len(out) - ok,
        results=out,
    )
