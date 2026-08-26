"""Pydantic v2 request/response models. Uzbek-facing only in messages."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── shared ──────────────────────────────────────────────────
class OkMsg(BaseModel):
    ok: bool = True
    message: str | None = None


# ── projects ────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    product_name: str = Field(min_length=1)
    total_boxes: int = Field(gt=0)
    per_box: int = Field(gt=0)
    has_loose: bool = False
    loose_qty: int = Field(0, ge=0)
    series: str = Field(min_length=1)          # manufacturing batch / seriya
    business_place_id: str = ""
    production_order_id: str = ""
    km_codes_text: str = ""      # newline-separated (raw)
    box_codes_text: str = ""     # newline-separated (raw)


class InventorySeriesCodes(BaseModel):
    """One series with its uploaded KM codes (raw text, newline-separated)."""
    name: str = Field(min_length=1)
    km_codes_text: str = ""


class InventoryProjectCreate(BaseModel):
    """Warehouse-inventory project. No SSCC pool, no capacity, no MOD/API key —
    those are the aggregation workflow only."""
    name: str = Field(min_length=1)
    product_name: str = Field(min_length=1)
    series: list[InventorySeriesCodes] = Field(min_length=1)


class ProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    product_name: str
    total_boxes: int
    per_box: int
    has_loose: bool
    loose_qty: int
    status: str
    mode: str = "aggregation"
    series: str = ""
    created_at: datetime


class ProjectPlan(ProjectSummary):
    full_boxes: int
    planned_km: int
    business_place_id: str
    production_order_id: str
    series: str = ""
    inventory_series: list[str] = []      # inventory mode only


# ── file parse ──────────────────────────────────────────────
class ParseFileResult(BaseModel):
    kind: Literal["km", "box"]
    codes: list[str]
    warnings: list[str]
    count: int


# ── scanning state (returned after every write) ─────────────
class InventoryCodeInBox(BaseModel):
    """One physical code inside a closed inventory box, with which series it
    matched (empty list = code was NOT in any uploaded series → 'extra')."""
    km_code: str
    matched_series: list[str] = []


class ClosedBoxOut(BaseModel):
    id: int
    sscc: str
    codes_count: int
    capacity: int
    is_loose: bool
    closed_at: datetime
    # Inventory-only breakdown, filled by /projects/{id}/boxes/{box_id}/contents.
    matched_count: int = 0
    extra_count: int = 0


class MissingPreview(BaseModel):
    count: int
    preview: list[str]     # first 16


class ScanState(BaseModel):
    project: ProjectPlan
    total_km:       int
    scanned_km:     int
    aggregated_km:  int
    pending_km:     int
    full_closed:    int
    loose_closed:   bool
    closed_boxes:   list[ClosedBoxOut]
    current_codes:  list[str]      # KMs in operator's open box (in scan order)
    current_capacity: int
    current_is_loose: bool
    missing_km:     MissingPreview
    missing_box:    MissingPreview


class ScanRequest(BaseModel):
    code: str
    # >1 when the client is re-sending after a network failure. Lets the
    # server treat "already in your own open box" as success, not a duplicate.
    attempt: int = 1


class ScanResponse(BaseModel):
    level: Literal["hit", "err", "warn"]
    message: str
    kind: Optional[str] = None
    code: Optional[str] = None
    state: ScanState


class ScanBatchRequest(BaseModel):
    codes: list[str]
    attempt: int = 1


class ScanResult(BaseModel):
    """Verdict for one code inside a batch."""
    code: str                      # the raw string the operator scanned
    level: Literal["hit", "err", "warn"]
    message: str
    kind: Optional[str] = None


class ScanBatchResponse(BaseModel):
    results: list[ScanResult]
    accepted: int
    rejected: int
    state: ScanState


class ScanEventOut(BaseModel):
    id: int
    raw_code: str
    km_code: str
    level: str
    reason: str
    username: str = ""
    created_at: datetime


class LooseModeRequest(BaseModel):
    on: bool


# ── submission ──────────────────────────────────────────────
class ValidateResult(BaseModel):
    ok: bool
    reasons: list[str]


class SubmitRequest(BaseModel):
    api_key: str | None = None
    inn: str = ""
    business_place_id: str = ""
    production_order_id: str = ""


class ReportOut(BaseModel):
    report_index: int
    ok: bool
    http_status: int | None = None
    document_id: str | None = None
    error: str = ""
    unit_count: int
    code_count: int
    sscc_list: list[str]
    skipped: bool = False


class SubmitResponse(BaseModel):
    ok: bool
    reports: list[ReportOut] = []
    error: str | None = None
    total_reports: int = 0
