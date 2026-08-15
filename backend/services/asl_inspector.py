"""Marking-code inspector — port of xtrace_lookup_service.py (Streamlit app).

Two endpoints per code:
  POST /public/api/cod/private/codes                 → full detail
  POST /public/api/cod/nested-codes/owner-check      → parent/children/owner

Uses per-request Business User API key (like asl_stock). No Streamlit /
backend.py deps.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import requests

from ..config import get_settings

logger = logging.getLogger("asl.inspector")

REQUEST_TIMEOUT = 60
RATE_LIMIT_PAUSE = 2
MAX_RETRIES = 3
INTER_CODE_SLEEP = 0.4       # small pause between codes so we don't hammer ASL

OPEN_API_FALLBACK_SERVER = "https://aslbelgisi.uz"

STATUS_LABELS = {
    "EMITTED":            "Emissiya",
    "APPLIED":            "Nanesyon",
    "INTRODUCED":         "Aylanmaga kiritilgan",
    "IN_CIRCULATION":     "Aylanmada",
    "WITHDRAWN":          "Aylanmadan chiqarilgan",
    "RETIRED":            "Hisobdan chiqarilgan",
    "DISAGGREGATED":      "Dis-agregatsiya",
    "AGGREGATED":         "Agregatsiya",
    "WAIT_FOR_EMISSION":  "Emissiya kutmoqda",
    "RESERVED":           "Rezerv",
}


# ─────────────────────────────────────────────────────────────
# DATA CLASSES (same shape as xtrace_lookup_service.py)
# ─────────────────────────────────────────────────────────────
@dataclass
class BasicInfo:
    code: str = ""
    status: str = ""
    status_label: str = ""
    gtin: str = ""
    product_name: str = ""
    product_group: str = ""
    product_group_name: str = ""
    tnved_code: str = ""
    tnved_name: str = ""
    serial_number: str = ""
    batch: str = ""
    production_date: str = ""
    expiration_date: str = ""
    mrp: str = ""
    package_type: str = ""


@dataclass
class OwnerInfo:
    owner_inn: str = ""
    owner_name: str = ""
    owner_address: str = ""
    emitter_inn: str = ""
    emitter_name: str = ""
    emitter_address: str = ""
    manufacturer_inn: str = ""
    manufacturer_name: str = ""
    manufacturer_country: str = ""
    importer_inn: str = ""
    importer_name: str = ""


@dataclass
class AggregationInfo:
    parent_code: str = ""
    parent_type: str = ""
    child_codes: list = field(default_factory=list)
    aggregation_date: str = ""
    aggregation_document_id: str = ""
    hierarchy_level: str = ""
    is_aggregated: bool = False


@dataclass
class DocumentInfo:
    document_id: str = ""
    document_type: str = ""
    document_status: str = ""
    document_date: str = ""
    sender_inn: str = ""
    sender_name: str = ""
    receiver_inn: str = ""
    receiver_name: str = ""
    description: str = ""


@dataclass
class CustomsInfo:
    aic_code: str = ""
    customs_declaration: str = ""
    customs_date: str = ""
    country_of_origin: str = ""
    customs_status: str = ""


@dataclass
class LookupResult:
    success: bool = False
    error: str = ""
    http_status: int = 0
    is_html: bool = False
    raw_response: dict = field(default_factory=dict)
    basic: BasicInfo = field(default_factory=BasicInfo)
    owner: OwnerInfo = field(default_factory=OwnerInfo)
    aggregation: AggregationInfo = field(default_factory=AggregationInfo)
    documents: list = field(default_factory=list)
    customs: CustomsInfo = field(default_factory=CustomsInfo)


# ─────────────────────────────────────────────────────────────
# SERVICE
# ─────────────────────────────────────────────────────────────
class InspectorService:
    def __init__(self):
        settings = get_settings()
        primary = settings.asl_api_base.rstrip("/")
        roots = [primary, OPEN_API_FALLBACK_SERVER]
        self.cod_bases = []
        for r in roots:
            base = f"{r.rstrip('/')}/public/api/cod"
            if base not in self.cod_bases:
                self.cod_bases.append(base)
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AslBelgisi-Inspector/2.0",
        })

    # ── request wrapper ────────────────────────────────
    def _headers(self, api_key: str) -> dict:
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

    def _request_with_retry(self, method: str, url: str, api_key: str,
                            json_body: dict | None = None,
                            params: dict | None = None) -> dict:
        last_error: dict = {"success": False, "error": "Request failed",
                            "http_status": 0, "url": url}
        headers = self._headers(api_key)
        for _ in range(1):  # single auth variant (per-request Bearer)
            for _attempt in range(1, MAX_RETRIES + 1):
                try:
                    if method.upper() == "GET":
                        resp = self._session.get(url, headers=headers, params=params,
                                                 timeout=REQUEST_TIMEOUT)
                    else:
                        resp = self._session.post(url, headers=headers, json=json_body,
                                                  timeout=REQUEST_TIMEOUT)
                    text_lower = resp.text.lower()
                    ct = resp.headers.get("Content-Type", "").lower()
                    is_html = ("<html" in text_lower or "<!doctype html>" in text_lower
                               or "text/html" in ct)
                    if is_html:
                        return {"success": False, "is_html": True,
                                "error": f"HTML (status {resp.status_code})",
                                "http_status": resp.status_code,
                                "raw": resp.text[:1000], "url": url}
                    if resp.status_code in (200, 201):
                        try: data = resp.json()
                        except Exception: data = {"raw": resp.text[:1000]}
                        return {"success": True, "data": data,
                                "http_status": resp.status_code, "url": url}
                    if resp.status_code == 401:
                        return {"success": False, "error": "401 Unauthorized",
                                "http_status": 401, "raw": resp.text[:500], "url": url}
                    if resp.status_code == 429:
                        retry_after = int(resp.headers.get("Retry-After", RATE_LIMIT_PAUSE))
                        time.sleep(retry_after)
                        continue
                    last_error = {"success": False, "error": f"HTTP {resp.status_code}",
                                  "http_status": resp.status_code,
                                  "raw": resp.text[:500], "url": url}
                    break
                except requests.RequestException as e:
                    last_error = {"success": False, "error": str(e),
                                  "http_status": 0, "url": url}
                    break
        return last_error

    # ── endpoints ──────────────────────────────────────
    def lookup_code(self, api_key: str, code: str) -> LookupResult:
        result = LookupResult()
        code = code.strip()
        if not code or not api_key:
            result.error = "kod yoki API kalit yo'q"
            return result

        strategies: list[tuple[str, str, dict]] = []
        for base in self.cod_bases:
            strategies.append(("POST", f"{base}/private/codes", {"codes": [code]}))
            strategies.append(("POST", f"{base}/public/codes",  {"codes": [code]}))

        resp: dict = {"success": False, "error": "lookup failed", "http_status": 0}
        for method, url, body in strategies:
            resp = self._request_with_retry(method, url, api_key, json_body=body)
            if resp.get("success"):
                break

        if not resp["success"]:
            result.error = resp.get("error", "lookup failed")
            result.http_status = resp.get("http_status", 0)
            result.is_html = bool(resp.get("is_html", False))
            result.raw_response = {
                "error_response": resp.get("raw", "no raw data"),
                "http_status": resp.get("http_status", 0),
                "is_html": resp.get("is_html", False),
                "endpoint": resp.get("url", ""),
            }
            return result

        raw = resp["data"]
        # Handle "no data" shape.
        if isinstance(raw, dict):
            results_arr = raw.get("results", [])
            if isinstance(results_arr, list) and len(results_arr) == 0:
                forbidden = raw.get("forbiddenCodes", []) or []
                missing   = raw.get("missingCodes",   []) or []
                if forbidden:
                    result.error = "Ushbu kodga kirish rad etildi (huquqlar egaligi)"
                elif missing:
                    result.error = "Kod ASL Belgisi da topilmadi"
                else:
                    result.error = "Kod uchun ma'lumot qaytmadi"
                result.raw_response = raw
                result.http_status = resp.get("http_status", 0)
                return result

        result.raw_response = raw
        result.success = True
        result.http_status = resp.get("http_status", 0)
        result.basic = self._parse_basic(raw, code)
        result.owner = self._parse_owner(raw)
        result.aggregation = self._parse_aggregation(raw)
        result.documents = self._parse_documents(raw)
        result.customs = self._parse_customs(raw)
        return result

    def lookup_nested(self, api_key: str, inn: str, code: str) -> dict:
        strategies: list[tuple[str, str, dict]] = []
        for base in self.cod_bases:
            strategies.append(("POST", f"{base}/nested-codes/owner-check",
                               {"codes": [code], "ownerTin": inn}))
            strategies.append(("POST", f"{base}/nested-codes/owner-check",
                               {"codes": [code]}))
        resp: dict = {"success": False, "error": "nested lookup failed", "http_status": 0}
        for method, url, body in strategies:
            resp = self._request_with_retry(method, url, api_key, json_body=body)
            if resp.get("success"):
                break
        return resp

    def lookup_batch(self, api_key: str, inn: str,
                     codes: list[str]) -> list[LookupResult]:
        results: list[LookupResult] = []
        clean = [c.strip() for c in codes if c and c.strip()]
        for i, code in enumerate(clean):
            r = self.lookup_code(api_key, code)
            nested = self.lookup_nested(api_key, inn, code)
            if nested.get("success"):
                self._enrich_with_nested(r, nested["data"])
            results.append(r)
            if i < len(clean) - 1:
                time.sleep(INTER_CODE_SLEEP)
        return results

    # ── normalization (unchanged shape) ────────────────
    @staticmethod
    def _deep_get(d: Any, *keys: str, default: str = "") -> Any:
        cur = d
        for k in keys:
            if isinstance(cur, dict):
                cur = cur.get(k, {})
            elif isinstance(cur, list) and cur:
                cur = cur[0].get(k, {}) if isinstance(cur[0], dict) else {}
            else:
                return default
        if cur == {} or cur is None:
            return default
        return str(cur) if not isinstance(cur, (list, dict)) else cur

    @staticmethod
    def _pick_result_record(raw: Any) -> dict:
        if isinstance(raw, list) and raw:
            first = raw[0]
            if isinstance(first, dict):
                return first
        if isinstance(raw, dict):
            results = raw.get("results")
            if isinstance(results, list) and results and isinstance(results[0], dict):
                return results[0]
            data = raw.get("data")
            if isinstance(data, dict):
                dr = data.get("results")
                if isinstance(dr, list) and dr and isinstance(dr[0], dict):
                    return dr[0]
                return data
            if isinstance(data, list) and data and isinstance(data[0], dict):
                return data[0]
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def _locale_text(value: Any) -> str:
        if isinstance(value, dict):
            for key in ("en", "ru", "uz"):
                v = value.get(key)
                if isinstance(v, str) and v.strip():
                    return v.strip()
            for v in value.values():
                if isinstance(v, str) and v.strip():
                    return v.strip()
            return ""
        return value if isinstance(value, str) else ""

    def _parse_basic(self, raw: Any, code: str) -> BasicInfo:
        d = self._pick_result_record(raw)
        code_data     = d.get("codeData", {})     if isinstance(d, dict) else {}
        product_data  = d.get("productData", {})  if isinstance(d, dict) else {}
        package_data  = d.get("packageData", {})  if isinstance(d, dict) else {}
        g = self._deep_get
        status_val = (g(code_data, "status") or g(d, "status")
                      or g(d, "cisStatus") or "")
        return BasicInfo(
            code=g(code_data, "code", default=code) or g(d, "code", default=code) or g(d, "cis", default=code),
            status=status_val,
            status_label=STATUS_LABELS.get(status_val, ""),
            gtin=g(product_data, "gtin") or g(d, "gtin") or g(d, "productGtin"),
            product_name=(
                self._locale_text(product_data.get("name", ""))
                or self._locale_text(product_data.get("productName", ""))
                or self._locale_text(product_data.get("label", ""))
                or self._locale_text(product_data.get("fullName", ""))
                or g(product_data, "productName") or g(product_data, "name")
                or g(product_data, "fullName") or g(d, "productName") or g(d, "name")
            ),
            product_group=g(product_data, "productGroupId") or g(d, "productGroup") or g(d, "pg"),
            product_group_name=g(d, "productGroupName") or g(d, "pgName"),
            tnved_code=g(product_data, "tnvedCode") or g(d, "tnvedCode") or g(d, "tnved"),
            tnved_name=g(d, "tnvedName"),
            serial_number=g(code_data, "serialNumber") or g(product_data, "serialNumber") or g(d, "serialNumber"),
            batch=g(product_data, "productSeries") or g(d, "batch") or g(d, "batchNumber"),
            production_date=g(product_data, "productionDate") or g(d, "productionDate") or g(d, "prodDate"),
            expiration_date=g(product_data, "expirationDate") or g(d, "expirationDate") or g(d, "expDate"),
            mrp=g(product_data, "mrp") or g(d, "maxRetailPrice") or g(d, "mrp"),
            package_type=g(package_data, "packageType") or g(d, "packageType") or g(d, "packType"),
        )

    def _parse_owner(self, raw: Any) -> OwnerInfo:
        d = self._pick_result_record(raw)
        g = self._deep_get
        turnover = d.get("turnoverData", {}) if isinstance(d, dict) else {}
        owner    = turnover.get("ownerInfo", d.get("owner", {})) if isinstance(d, dict) else {}
        marking  = d.get("markingData", {}) if isinstance(d, dict) else {}
        emitter  = marking.get("issuerInfo", d.get("emitter", d.get("producer", {}))) if isinstance(d, dict) else {}
        manuf    = d.get("manufacturer", {}) if isinstance(d, dict) else {}
        importer = d.get("importer", {}) if isinstance(d, dict) else {}
        return OwnerInfo(
            owner_inn=g(owner, "inn") or g(owner, "ownerTin") or g(d, "ownerInn"),
            owner_name=self._locale_text(owner.get("ownerName", "")) or self._locale_text(owner.get("name", "")) or g(owner, "name") or g(d, "ownerName"),
            owner_address=g(owner, "address"),
            emitter_inn=g(emitter, "inn") or g(d, "emitterInn"),
            emitter_name=self._locale_text(emitter.get("issuerName", "")) or self._locale_text(emitter.get("name", "")) or g(emitter, "name") or g(d, "emitterName"),
            emitter_address=g(emitter, "address"),
            manufacturer_inn=g(manuf, "inn"),
            manufacturer_name=self._locale_text(manuf.get("name", "")) or g(manuf, "name") or g(d, "manufacturerName"),
            manufacturer_country=g(manuf, "country") or g(d, "manufacturerCountry"),
            importer_inn=g(importer, "inn"),
            importer_name=self._locale_text(importer.get("name", "")) or g(importer, "name"),
        )

    def _parse_aggregation(self, raw: Any) -> AggregationInfo:
        d = self._pick_result_record(raw)
        g = self._deep_get
        pkg = d.get("packageData", {}) if isinstance(d, dict) else {}
        children_raw = pkg.get("children",
                        d.get("childCodes",
                            d.get("children",
                                d.get("nestedCodes", [])))) if isinstance(d, dict) else []
        children = children_raw if isinstance(children_raw, list) else []
        parent = g(pkg, "parentCode") or g(d, "parentCode") or g(d, "parent")
        return AggregationInfo(
            parent_code=parent,
            parent_type=g(pkg, "parentType") or g(d, "parentType"),
            child_codes=children,
            aggregation_date=g(d, "aggregationDate") or g(d, "aggregatedDate"),
            aggregation_document_id=g(d, "aggregationDocumentId"),
            hierarchy_level=g(pkg, "packageType") or g(d, "hierarchyLevel") or g(d, "level"),
            is_aggregated=bool(parent),
        )

    def _parse_documents(self, raw: Any) -> list[DocumentInfo]:
        d = self._pick_result_record(raw)
        docs_raw = d.get("codeHistory",
                    d.get("documents",
                        d.get("history",
                            d.get("documentList", [])))) if isinstance(d, dict) else []
        if not isinstance(docs_raw, list):
            return []
        g = self._deep_get
        docs: list[DocumentInfo] = []
        for doc in docs_raw:
            if not isinstance(doc, dict):
                continue
            docs.append(DocumentInfo(
                document_id=g(doc, "documentId") or g(doc, "eventSourceId") or g(doc, "id"),
                document_type=g(doc, "documentType") or g(doc, "type"),
                document_status=(g(doc, "documentStatus") or g(doc, "eventChangedCodeStatus")
                                 or g(doc, "eventChangedCodeExtStatus") or g(doc, "status")),
                document_date=g(doc, "documentDate") or g(doc, "eventDate") or g(doc, "date"),
                sender_inn=g(doc, "senderInn") or g(doc, "sender", "inn"),
                sender_name=self._locale_text(doc.get("senderName", "")) or g(doc, "senderName") or g(doc, "sender", "name"),
                receiver_inn=g(doc, "receiverInn") or g(doc, "receiver", "inn"),
                receiver_name=self._locale_text(doc.get("receiverName", "")) or g(doc, "receiverName") or g(doc, "receiver", "name"),
                description=g(doc, "description"),
            ))
        return docs

    def _parse_customs(self, raw: Any) -> CustomsInfo:
        d = self._pick_result_record(raw)
        g = self._deep_get
        customs = d.get("customs", d.get("aic", {})) if isinstance(d, dict) else {}
        return CustomsInfo(
            aic_code=g(d, "aicCode") or g(customs, "aicCode"),
            customs_declaration=g(d, "customsDeclaration") or g(customs, "declaration"),
            customs_date=g(customs, "date"),
            country_of_origin=g(d, "countryOfOrigin") or g(customs, "country"),
            customs_status=g(customs, "status"),
        )

    def _enrich_with_nested(self, result: LookupResult, nested_data: Any) -> None:
        d = nested_data
        if isinstance(nested_data, dict) and isinstance(nested_data.get("data"), dict):
            d = nested_data["data"]
        elif isinstance(nested_data, dict) and isinstance(nested_data.get("data"), list) and nested_data["data"]:
            d = nested_data["data"][0]
        g = self._deep_get
        if not result.aggregation.parent_code:
            result.aggregation.parent_code = g(d, "parentCode") or g(d, "parent")
            result.aggregation.is_aggregated = bool(result.aggregation.parent_code)
        if not result.aggregation.child_codes:
            children = d.get("childCodes", d.get("children", d.get("nestedCodes", []))) if isinstance(d, dict) else []
            if isinstance(children, list):
                result.aggregation.child_codes = children
        if not result.owner.owner_inn:
            result.owner.owner_inn = g(d, "ownerInn") or g(d, "owner", "inn")
        if not result.owner.owner_name:
            result.owner.owner_name = g(d, "ownerName") or g(d, "owner", "name")


# module-level singleton, cheap to reuse
_service: InspectorService | None = None
def service() -> InspectorService:
    global _service
    if _service is None:
        _service = InspectorService()
    return _service


# ── helpers used by the API (Streamlit page had them inline) ──
def pick_emission_date(result: LookupResult) -> str:
    raw = result.raw_response if isinstance(result.raw_response, dict) else {}
    for path in (
        ("markingData", "emissionDate"),
        ("markingData", "issueDate"),
        ("turnoverData", "emissionDate"),
        ("emissionDate",),
        ("issueDate",),
    ):
        node = raw
        for key in path:
            if not isinstance(node, dict):
                node = ""
                break
            node = node.get(key, "")
        if isinstance(node, str) and node.strip():
            return node.strip()
    return ""


def summary_owner(result: LookupResult) -> str:
    owner = result.owner.owner_name or result.owner.emitter_name or "-"
    tin = result.owner.owner_inn or result.owner.emitter_inn
    return f"{owner} (TIN: {tin})" if tin else owner


def summary_product(result: LookupResult) -> str:
    gtin = result.basic.gtin or "-"
    name = result.basic.product_name or "-"
    return f"GTIN: {gtin}" if name == "-" else f"GTIN: {gtin} | {name}"
