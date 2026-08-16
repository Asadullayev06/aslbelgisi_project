"""CSV / TXT parsers for the Custom Aggregation flow.

Ports backend.py::CSVProcessor (KM upload + SSCC upload) verbatim.
"""
from __future__ import annotations

import csv
import io

from .sscc_generator import SSCCGenerator

HEADER_PATTERNS = {
    "code", "km", "marking_code", "markingcode",
    "mother_code", "mothercode",
    "код", "км", "маркировка",
}


def normalize_code(code: str) -> str:
    return (
        code.strip()
        .strip('"')
        .replace("\\u001d", "\x1d")
        .replace("\\x1d", "\x1d")
    )


def to_aggregation_code(code: str) -> str:
    """Reduce full DataMatrix payload to the identity portion ASL wants:
       `01 + GTIN(14) + 21 + serial` (matches asl_inspector.canonical_km logic)."""
    normalized = normalize_code(str(code))
    if "\x1d" in normalized:
        return normalized.split("\x1d", 1)[0]
    if normalized.startswith("01") and len(normalized) > 31 and normalized[16:18] == "21":
        return normalized[:31]
    return normalized


def looks_like_full_km(code: str) -> bool:
    n = normalize_code(code).replace("\x1d", "")
    return len(n) >= 16 and n.startswith("01") and n[:16].isdigit()


def parse_km_csv(file_content: bytes, validate_medicine: bool = True) -> dict:
    """Same result shape as backend.py::CSVProcessor.parse_csv."""
    try:
        text = file_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = file_content.decode("latin-1")
        except Exception:
            return {"codes": [], "invalid": [], "warnings": ["Faylni o'qib bo'lmadi"], "total_raw": 0}

    codes: list[str] = []
    invalid: list[tuple[int, str, str]] = []
    warnings: list[str] = []
    total_raw = 0
    seen: dict[str, int] = {}   # canonical code -> first line it was seen on

    reader = csv.reader(io.StringIO(text))
    for line_num, row in enumerate(reader, start=1):
        if not row:
            continue
        code = row[0].strip()
        if not code:
            continue
        if code.lower() in HEADER_PATTERNS:
            continue

        total_raw += 1
        code = normalize_code(code)

        if len(code) < 10:
            invalid.append((line_num, code, "Kod juda qisqa (< 10)"))
            continue
        if validate_medicine and not looks_like_full_km(code):
            invalid.append((line_num, code, "To'liq KM 'GS1 AI 01' bilan boshlanishi kerak"))
            continue

        canonical = to_aggregation_code(code) if validate_medicine else code
        # Duplicate detection: same identity appearing twice would fail at ASL
        # ("code already utilized/aggregated"); flag it up front so the user
        # can clean the file before submit.
        if canonical in seen:
            invalid.append((line_num, code, f"takroriy — {seen[canonical]}-qatorda ham bor"))
            continue
        seen[canonical] = line_num
        codes.append(canonical)

    if not codes and total_raw > 0:
        warnings.append("Barcha kodlar tekshiruvdan o'tmadi")

    return {"codes": codes, "invalid": invalid, "warnings": warnings, "total_raw": total_raw}


def parse_sscc_file(file_content: bytes) -> dict:
    """Parse SSCC file. Returns the same shape as parse_km_csv:
        {codes[], invalid[(line_num, code, reason)], warnings[], total_raw}
    Codes are canonicalized to the 20-char AI(00)+SSCC form ASL expects.
    Detects both invalid check digits and duplicates."""
    try:
        text = file_content.decode("utf-8-sig")
    except Exception:
        text = file_content.decode("latin-1")

    codes: list[str] = []
    invalid: list[tuple[int, str, str]] = []
    warnings: list[str] = []
    total_raw = 0
    seen: dict[str, int] = {}

    for line_num, line in enumerate(text.splitlines(), start=1):
        c = line.strip().strip('"')
        if not c:
            continue
        total_raw += 1
        ok, err = SSCCGenerator.validate_sscc(c)
        if not ok:
            invalid.append((line_num, c, err))
            continue
        canonical = SSCCGenerator.to_parent_package_code(c)
        if canonical in seen:
            invalid.append((line_num, c, f"takroriy — {seen[canonical]}-qatorda ham bor"))
            continue
        seen[canonical] = line_num
        codes.append(canonical)

    if not codes and total_raw > 0:
        warnings.append("Barcha SSCC tekshiruvdan o'tmadi")

    return {"codes": codes, "invalid": invalid, "warnings": warnings, "total_raw": total_raw}


def chunk_codes(codes: list[str], group_size: int) -> list[list[str]]:
    if group_size < 1:
        raise ValueError("group_size >= 1 bo'lishi kerak")
    return [codes[i:i + group_size] for i in range(0, len(codes), group_size)]
