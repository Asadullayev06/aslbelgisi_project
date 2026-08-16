"""Custom aggregation API — file parsers, MOD list, run (dry-run + submit).

Auth: admin only. Custom aggregation goes straight to ASL as the requesting
INN — should be gated to admin like /submit."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..auth import current_user, require_admin
from ..models import User
from ..services import asl_stock, csv_parser, custom_aggregation

router = APIRouter(prefix="/api/custom-agg", tags=["custom-agg"])


# ── file parse ──────────────────────────────────────────────
class KmParseResp(BaseModel):
    codes: list[str]
    invalid: list[list]                      # [line_num, code, reason]
    warnings: list[str] = []
    total_raw: int = 0

class SsccParseResp(BaseModel):
    codes: list[str]                         # canonicalized 20-char, deduped
    total: int = 0
    invalid: list[list] = []                 # [line_num, code, reason]
    warnings: list[str] = []
    total_raw: int = 0


@router.post("/parse-km", response_model=KmParseResp)
async def parse_km(
    validate_medicine: bool = True,
    file: UploadFile = File(...),
    _u: User = Depends(current_user),
):
    raw = await file.read()
    result = csv_parser.parse_km_csv(raw, validate_medicine=validate_medicine)
    return KmParseResp(**result)


@router.post("/parse-sscc", response_model=SsccParseResp)
async def parse_sscc(file: UploadFile = File(...),
                     _u: User = Depends(current_user)):
    raw = await file.read()
    r = csv_parser.parse_sscc_file(raw)
    return SsccParseResp(
        codes=r["codes"],
        total=len(r["codes"]),
        invalid=r["invalid"],
        warnings=r["warnings"],
        total_raw=r["total_raw"],
    )


# ── MOD list ────────────────────────────────────────────────
class ModListBody(BaseModel):
    inn: str = Field(min_length=1)
    api_key: str = Field(min_length=1)

class ModItem(BaseModel):
    id: str
    name: str = ""
    raw: dict | list | str | None = None

class ModListResp(BaseModel):
    ok: bool
    mods: list[ModItem] = []
    error: str = ""


def _normalize_mods(data) -> list[ModItem]:
    """ASL responses vary; try to squeeze them into {id, name}."""
    if isinstance(data, dict) and isinstance(data.get("data"), (list, dict)):
        data = data["data"]
    if isinstance(data, dict):
        data = [data]
    out: list[ModItem] = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                mid = str(item.get("id") or item.get("modId") or item.get("code") or "").strip()
                if not mid:
                    continue
                name = str(item.get("name") or item.get("title") or item.get("label") or "").strip()
                out.append(ModItem(id=mid, name=name, raw=item))
            else:
                mid = str(item).strip()
                if mid:
                    out.append(ModItem(id=mid))
    return out


@router.post("/mod-list", response_model=ModListResp)
def mod_list(body: ModListBody, _u: User = Depends(current_user)):
    res = asl_stock.fetch_mod_list(body.inn.strip(), body.api_key.strip())
    if not res.get("success"):
        return ModListResp(ok=False, error=res.get("error", "MOD ro'yxatini yuklab bo'lmadi"))
    return ModListResp(ok=True, mods=_normalize_mods(res.get("data")))


# ── run (dry-run + submit) ──────────────────────────────────
class RunBody(BaseModel):
    api_key: str = ""                        # required only for submit
    codes: list[str]
    group_size: int = Field(gt=0, le=custom_aggregation.MAX_CODES_PER_AGGREGATION_UNIT)
    business_place_id: str = ""
    production_order_id: str = ""
    # SSCC config
    sscc_source: Literal["auto", "upload"] = "auto"
    sscc_inn: str = ""
    sscc_use_gcp: bool = False
    sscc_gcp_prefix: str = ""
    sscc_start: int = 1
    sscc_uploaded: list[str] = Field(default_factory=list)
    mode: Literal["dry_run", "submit"] = "dry_run"


class GroupOut(BaseModel):
    index: int
    sscc: str
    codes_count: int

class CodeErrorOut(BaseModel):
    code: str = ""
    error_code: str = ""
    index: int | None = None
    property: str = ""
    tags: dict = {}

class ReportOut(BaseModel):
    report_index: int
    unit_count: int
    code_count: int
    sscc_list: list[str]
    group_indices: list[int]
    ok: bool
    http_status: int
    document_id: str
    error: str = ""
    # Set after ASL asynchronously processes the doc (poll of /storage/docs/{id}).
    verification_status: str = ""           # PROCESSED | ERROR | STATUS_FETCH_FAILED | PENDING | ...
    code_errors: list[CodeErrorOut] = []    # per-code failures returned by ASL
    timed_out: bool = False                 # polling gave up; recheck later

class RunResp(BaseModel):
    ok: bool
    mode: str
    errors: list[str] = []
    groups: list[GroupOut] = []
    reports: list[ReportOut] = []
    total_reports: int = 0


@router.post("/run", response_model=RunResp)
def run(body: RunBody, u: User = Depends(current_user)):
    # Only admin can actually submit; anyone can dry-run.
    if body.mode == "submit" and u.role != "admin":
        raise HTTPException(status_code=403, detail="Faqat admin submit qila oladi")

    if not body.codes:
        raise HTTPException(400, "KM ro'yxati bo'sh")

    # Server-side duplicate guard for the codes actually about to be sent.
    # The parse-* endpoints already dedupe, but a hand-crafted /run request
    # could still contain duplicates. Reject rather than let ASL bounce us
    # later with `code already utilized/aggregated`.
    seen_km: set[str] = set()
    km_dupes: list[str] = []
    for c in body.codes:
        if c in seen_km: km_dupes.append(c)
        else: seen_km.add(c)
    if km_dupes:
        raise HTTPException(400,
            f"KM ro'yxatida takroriy kodlar bor ({len(km_dupes)} ta). "
            "Avval fayldagi takrorlarni olib tashlang.")

    if body.sscc_source == "upload":
        seen_ssc: set[str] = set()
        ssc_dupes: list[str] = []
        for s in body.sscc_uploaded:
            if s in seen_ssc: ssc_dupes.append(s)
            else: seen_ssc.add(s)
        if ssc_dupes:
            raise HTTPException(400,
                f"SSCC ro'yxatida takroriy kodlar bor ({len(ssc_dupes)} ta).")

    result = custom_aggregation.run(
        api_key=body.api_key,
        codes=body.codes,
        group_size=body.group_size,
        business_place_id=body.business_place_id,
        production_order_id=body.production_order_id,
        sscc_source=body.sscc_source,
        sscc_inn=body.sscc_inn or body.business_place_id or "",
        sscc_use_gcp=body.sscc_use_gcp,
        sscc_gcp_prefix=body.sscc_gcp_prefix,
        sscc_start=body.sscc_start,
        sscc_uploaded=body.sscc_uploaded,
        mode=body.mode,
    )
    return RunResp(**result)
