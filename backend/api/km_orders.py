"""ASL ICOM marking-code orders (OPEN API 1.28, sections 4.1-4.4)."""
from __future__ import annotations

import re

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import current_user
from ..config import get_settings
from ..models import User
from ..services.asl_stock import verify_api_key_ownership

router = APIRouter(prefix="/api/km-orders", tags=["km-orders"])
GROUPS = {"vegetableoil", "bio", "tobacco", "alcohol", "beer", "pharma", "water",
          "medicals", "appliances", "antiseptic", "fertilizers"}
PURPOSES = {"PRIMARY", "REMAINS", "COMISSION", "REMARK"}
PACKAGES = {"UNIT", "GROUP", "SET", "BOX_LV_1", "BOX_LV_2"}
UUID = re.compile(r"^[0-9a-fA-F-]{36}$")


class Credentials(BaseModel):
    inn: str = Field(pattern=r"^\d{9}$")
    api_key: str = Field(min_length=1)


class Product(BaseModel):
    gtin: str = Field(pattern=r"^\d{14}$")
    quantity: int = Field(ge=1, le=150000)
    cis_type: str = "UNIT"


class OrderBody(Credentials):
    product_group: str
    release_method_type: str = "PRIMARY"
    business_place_id: int | None = Field(default=None, gt=0)
    products: list[Product] = Field(min_length=1, max_length=10)
    po_number: str = ""


class OrderLookup(Credentials):
    order_id: str


class OrderSearch(Credentials):
    po_number: str = ""
    product_group: str = ""


class ReceiveBody(OrderLookup):
    gtin: str = Field(pattern=r"^\d{14}$")
    quantity: int = Field(ge=1, le=150000)
    last_pack_id: str = ""


def _verified(inn: str, key: str):
    result = verify_api_key_ownership(inn, key)
    if not result.get("success"):
        raise HTTPException(400, result.get("error", "ASL kalitini tekshirib bo'lmadi"))
    data = result.get("data")
    if not isinstance(data, dict) or data.get("isTinCorrect") is not True:
        raise HTTPException(403, "API kalit ushbu firma INN raqamiga tegishli emas")


def _call(method: str, path: str, key: str, **kwargs):
    try:
        response = requests.request(
            method, f"{get_settings().asl_api_base.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json",
                     "Content-Type": "application/json;charset=UTF-8"},
            timeout=45, **kwargs,
        )
    except requests.RequestException as exc:
        raise HTTPException(502, f"ASL bilan aloqa xatosi: {exc}") from exc
    if not response.ok:
        raise HTTPException(502, f"ASL HTTP {response.status_code}: {response.text[:500]}")
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(502, "ASL noto'g'ri JSON javob qaytardi") from exc


@router.post("/verify")
def verify(body: Credentials, _user: User = Depends(current_user)):
    _verified(body.inn, body.api_key)
    return {"ok": True}


@router.post("")
def create_order(body: OrderBody, _user: User = Depends(current_user)):
    if body.product_group not in GROUPS or body.release_method_type not in PURPOSES:
        raise HTTPException(400, "Mahsulot guruhi yoki markirovka maqsadi noto'g'ri")
    if any(p.cis_type not in PACKAGES for p in body.products):
        raise HTTPException(400, "Qadoq turi noto'g'ri")
    if len({p.gtin for p in body.products}) != len(body.products):
        raise HTTPException(400, "Bitta GTIN bir buyurtmada takrorlanmasligi kerak")
    _verified(body.inn, body.api_key)
    payload = {"productGroup": body.product_group,
               "releaseMethodType": body.release_method_type,
               "products": [{"gtin": p.gtin, "quantity": p.quantity,
                             "cisType": p.cis_type, "serialNumberType": "OPERATOR"}
                            for p in body.products]}
    if body.business_place_id is not None:
        payload["businessPlaceId"] = body.business_place_id
    if body.po_number.strip():
        payload["poNumber"] = body.po_number.strip()
    result = _call("POST", "/api/orders", body.api_key, json=payload)
    if not isinstance(result, dict) or not result.get("orderId"):
        raise HTTPException(502, "ASL buyurtma raqamini qaytarmadi")
    return {"order_id": result["orderId"]}


@router.post("/status")
def status(body: OrderLookup, _user: User = Depends(current_user)):
    if not UUID.fullmatch(body.order_id):
        raise HTTPException(400, "Buyurtma ID noto'g'ri")
    _verified(body.inn, body.api_key)
    orders = _call("GET", "/api/orders", body.api_key, params={"orderId": body.order_id})
    suborders = _call("GET", "/api/orders/sub-orders", body.api_key,
                      params={"orderId": body.order_id})
    return {"orders": orders, "suborders": suborders}


@router.post("/search")
def search_orders(body: OrderSearch, _user: User = Depends(current_user)):
    """Read-only recovery after an order POST returns no usable response."""
    # ASL scopes GET /api/orders to the Bearer key's owner. Repeating the
    # separate INN ownership check here adds another remote request (and uses
    # its daily quota) before this recovery lookup can run.
    params = {"limit": 100}
    if body.po_number.strip():
        params["poNumber"] = body.po_number.strip()
    if body.product_group in GROUPS:
        params["productGroup"] = body.product_group
    return _call("GET", "/api/orders", body.api_key, params=params)


@router.post("/receive")
def receive(body: ReceiveBody, _user: User = Depends(current_user)):
    if not UUID.fullmatch(body.order_id) or (body.last_pack_id and not UUID.fullmatch(body.last_pack_id)):
        raise HTTPException(400, "Buyurtma yoki paket ID noto'g'ri")
    _verified(body.inn, body.api_key)
    params = {"orderId": body.order_id, "gtin": body.gtin, "quantity": body.quantity}
    if body.last_pack_id:
        params["lastPackId"] = body.last_pack_id
    return _call("GET", "/api/codes", body.api_key, params=params)
