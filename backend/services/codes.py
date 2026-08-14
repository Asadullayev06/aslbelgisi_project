"""KM/SSCC parsing helpers — copied VERBATIM from pages/7_Guided_Mass_Aggregation.py.

Each of these exists because of a real bug fixed during the Streamlit build.
Do NOT "clean them up" without reading plan.md §0.

  * canonical_km          — reduce any KM to the 31-char sSGTIN identity
  * unescape_xml_controls — Excel writes GS as `_x001D_`; undo
  * normalize_sscc        — SSCC-18 or 20-char '00…' → canonical 20-char form
  * classify_scan         — 'km' | 'sscc' | 'unknown'
  * parse_pool_text       — text → clean, deduped, canonical KM list
  * parse_box_pool_text   — text → clean, deduped, normalized SSCC list
  * extract_cells_from_file → CSV / TSV / TXT / XLSX / XLS → list[str] cells
  * parse_km_file / parse_box_file → convenience wrappers
"""
from __future__ import annotations

import io
import re
from typing import BinaryIO

import pandas as pd

# ── constants (match page 7 & plan.md) ─────────────────────────
MIN_KM_LENGTH = 20
KM_IDENTIFIER_LEN = 31       # 01 + GTIN(14) + 21 + serial(13)
SSCC_LEN = 18
SSCC_PREFIX = "00"

_XML_ESC = re.compile(r"_x([0-9A-Fa-f]{4})_")


def unescape_xml_controls(s: str) -> str:
    """`_xHHHH_` → real Unicode character. Excel writes U+001D (GS) that way."""
    return _XML_ESC.sub(lambda m: chr(int(m.group(1), 16)), s)


def canonical_km(code: str) -> str:
    """Return the 31-char sSGTIN identity of a KM.

    The full CIS from Excel/scanner may contain AI 91 verification key + AI 92
    crypto signature (total ~83 chars). Identity is only `01 + GTIN(14) + 21 +
    serial(13)`. Everything after is verification, not identity.
    """
    s = unescape_xml_controls(code.strip().strip('"').strip("'"))
    if not s:
        return ""
    if s.startswith("01") and len(s) >= KM_IDENTIFIER_LEN:
        return s[:KM_IDENTIFIER_LEN]
    gs = s.find("\x1d")
    if gs > 0:
        return s[:gs]
    return s


def normalize_sscc(v: str) -> str:
    """SSCC-18 (18 digits) OR 20-char '00'+18digits → canonical 20-char form."""
    v = v.strip()
    if len(v) == SSCC_LEN and v.isdigit():
        return SSCC_PREFIX + v
    if len(v) == SSCC_LEN + 2 and v.startswith(SSCC_PREFIX) and v[2:].isdigit():
        return v
    raise ValueError(f"noto'g'ri SSCC-18: {v!r}")


def classify_scan(value: str) -> str:
    v = value.strip()
    if not v:
        return "unknown"
    digits = v.isdigit()
    if digits and len(v) == SSCC_LEN:
        return "sscc"
    if digits and len(v) == SSCC_LEN + 2 and v.startswith(SSCC_PREFIX):
        return "sscc"
    if len(v) >= MIN_KM_LENGTH:
        return "km"
    return "unknown"


def parse_pool_text(text: str) -> tuple[list[str], list[str]]:
    """KM text → (canonical codes, warnings). Deduped."""
    warnings, valid, seen = [], [], set()
    for raw in text.splitlines():
        c = canonical_km(raw)
        if not c:
            continue
        if len(c) < MIN_KM_LENGTH:
            warnings.append(f"qisqa kod (<{MIN_KM_LENGTH}): {c}")
            continue
        if c in seen:
            warnings.append(f"takroriy kod: {c}")
            continue
        seen.add(c)
        valid.append(c)
    return valid, warnings


def parse_box_pool_text(text: str) -> tuple[list[str], list[str]]:
    """SSCC text → (normalized codes, warnings). Deduped."""
    warnings, valid, seen = [], [], set()
    for raw in text.splitlines():
        c = unescape_xml_controls(raw.strip().strip('"').strip("'"))
        if not c:
            continue
        try:
            norm = normalize_sscc(c)
        except ValueError:
            warnings.append(f"noto'g'ri SSCC: {c[:24]}")
            continue
        if norm in seen:
            warnings.append(f"takroriy SSCC: {norm}")
            continue
        seen.add(norm)
        valid.append(norm)
    return valid, warnings


def extract_cells_from_file(name: str, raw: bytes) -> list[str]:
    """Yield every non-empty cell from CSV/TSV/TXT/XLSX/XLS.

    IMPORTANT: uses `header=None` for both pandas readers — the previous
    Streamlit code lost row 1 (10000 → 9999) because pandas defaults to
    `header=0` and eats the first row as column names.
    """
    lname = (name or "").lower()
    candidates: list[str] = []

    if lname.endswith((".xlsx", ".xlsm", ".xls")):
        try:
            sheets = pd.read_excel(
                io.BytesIO(raw), dtype=str, sheet_name=None,
                header=None, engine=None,
            )
        except Exception:
            return []
        for df in sheets.values():
            for col in df.columns:
                for v in df[col].dropna().tolist():
                    s = str(v).strip()
                    if s:
                        candidates.append(s)
        return candidates

    if isinstance(raw, bytes):
        text = raw.decode("utf-8-sig", errors="replace")
    else:
        text = raw

    parsed_any = False
    for sep in (None, ",", ";", "\t", "|"):
        try:
            df = pd.read_csv(
                io.StringIO(text), dtype=str,
                sep=sep, engine="python", header=None,
                on_bad_lines="skip", quoting=3,   # QUOTE_NONE
            )
        except Exception:
            continue
        cells: list[str] = []
        for col in df.columns:
            for v in df[col].dropna().tolist():
                s = str(v).strip()
                if s:
                    cells.append(s)
        if len(cells) > len(candidates):
            candidates = cells
            parsed_any = True

    if not parsed_any or not candidates:
        candidates = [t for t in re.split(r"[\s,;\t]+", text) if t]

    return candidates


def parse_km_file(name: str, raw: bytes) -> tuple[list[str], list[str]]:
    return parse_pool_text("\n".join(extract_cells_from_file(name, raw)))


def parse_box_file(name: str, raw: bytes) -> tuple[list[str], list[str]]:
    return parse_box_pool_text("\n".join(extract_cells_from_file(name, raw)))
