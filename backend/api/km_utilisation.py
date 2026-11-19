"""KM application reports: ASL OPEN API 1.28 sections 5.1 and 11."""
from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from ..auth import current_user
from ..models import User
from .km_orders import Credentials, GROUPS, _call, _verified

router = APIRouter(prefix="/api/km-utilisation", tags=["km-utilisation"])

class Application(Credentials):
    product_group: str
    business_place_id: int = Field(gt=0)
    release_type: str
    manufacturer_country: str = Field(pattern=r"^[A-Z]{2}$")
    production_date: datetime | None = None
    expiration_date: datetime | None = None
    series_number: str = Field(default="", max_length=20)
    production_order_id: str = ""
    codes: list[str] = Field(min_length=1, max_length=30000)

class ReportLookup(Credentials):
    report_id: UUID

@router.post("")
def submit(body: Application, _user: User = Depends(current_user)):
    if body.product_group not in GROUPS or body.release_type not in {"PRODUCTION", "IMPORT", "CIRCULATION"}:
        raise HTTPException(400, "Mahsulot guruhi yoki chiqarish usuli noto'g'ri")
    if body.product_group == "pharma" and not body.series_number.strip():
        raise HTTPException(400, "Dori vositalari uchun seriya raqami majburiy")
    if body.product_group != "appliances" and (not body.production_date or not body.expiration_date):
        raise HTTPException(400, "Ishlab chiqarish va yaroqlilik sanalari majburiy")
    now = datetime.now(timezone.utc)
    for date in (body.production_date, body.expiration_date):
        if date and date.utcoffset() is None:
            raise HTTPException(400, "Sanada vaqt mintaqasi bo'lishi kerak")
    if body.production_date and body.production_date > now:
        raise HTTPException(400, "Ishlab chiqarish sanasi kelajakda bo'lishi mumkin emas")
    if body.expiration_date and body.expiration_date < now:
        raise HTTPException(400, "Yaroqlilik muddati o'tgan")
    if len(set(body.codes)) != len(body.codes):
        raise HTTPException(400, "KM kodlar takrorlanmoqda")
    if any(not c.startswith("01") or len(c) < 20 or "\x1d" not in c or "\n" in c or "\r" in c for c in body.codes):
        raise HTTPException(400, "To'liq KM kod va GS ajratgich kerak; qisqartirilgan kod yuborilmaydi")
    _verified(body.inn, body.api_key)
    payload = {"sntins": body.codes, "businessPlaceId": body.business_place_id,
               "releaseType": body.release_type, "manufacturerCountry": body.manufacturer_country}
    for name, value in (("productionDate", body.production_date), ("expirationDate", body.expiration_date)):
        if value: payload[name] = value.isoformat()
    if body.series_number.strip(): payload["seriesNumber"] = body.series_number.strip()
    if body.production_order_id.strip(): payload["productionOrderId"] = body.production_order_id.strip()
    result = _call("POST", "/api/utilisation", body.api_key,
                   params={"productGroup": body.product_group}, json=payload)
    if not isinstance(result, dict) or not result.get("reportId"):
        raise HTTPException(502, "ASL reportId qaytarmadi. Qayta yuborishdan oldin ASLda tekshiring.")
    return result

@router.post("/status")
def status(body: ReportLookup, _user: User = Depends(current_user)):
    return _call("GET", f"/public/api/v1/doc/storage/docs/{body.report_id}", body.api_key)
