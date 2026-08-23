"""BarTender CSV generator — turns a list of ASL Belgisi KM codes into
the printer's expected 5-column CSV.

Output columns per code:
    A → full original code
    B → code[:31]                (canonical KM identity)
    C → code[16:31]              (chars 17–31)
    D → empty
    E → "<n>-<total>"            (sequential — 1-450, 2-450, ..., 450-450)

Difference from the legacy Streamlit page: E is a plain running number
against the total instead of "<box>-<item>", and there are NO 4-row
separator blocks between boxes. The E value is still prefixed with a
zero-width space so Excel doesn't reinterpret it as a date/formula
when someone opens the CSV directly.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from ..auth import current_user
from ..models import User
from ..services.codes import extract_cells_from_file

router = APIRouter(prefix="/api/bartender", tags=["bartender"])

# Zero-width space — forces Excel to treat the cell as text so "1-450"
# doesn't become a date and long tokens don't become scientific notation.
_ZWSP = "​"


def _to_bartender_rows(codes: list[str]) -> list[list[str]]:
    """Build the 5-column rows. Codes shorter than 31 chars are still
    emitted — we don't invent characters; the printer will get whatever
    slice exists (matches the old app's behaviour)."""
    total = len(codes)
    rows: list[list[str]] = []
    for i, raw in enumerate(codes, start=1):
        code = str(raw).strip()
        col_b = code[:31]
        col_c = code[16:31] if len(code) > 16 else code[-1:]
        rows.append([code, col_b, col_c, "", f"{_ZWSP}{i}-{total}"])
    return rows


@router.post("/generate")
async def generate(file: UploadFile = File(...),
                   _u: User = Depends(current_user)):
    """Upload .xlsx/.csv/.tsv/.txt → download the BarTender CSV.

    Uses the same `extract_cells_from_file` helper the aggregation setup
    and search pages use, so parsing behaviour is consistent (the file
    tolerances, the header=None rule that prevents losing row 1, etc.).
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "fayl bo'sh")

    name = file.filename or ""
    cells = extract_cells_from_file(name, raw)

    # Filter empty / whitespace-only entries and any obvious 'nan' pandas
    # sentinels that slip through from mixed spreadsheets.
    codes = [c.strip() for c in cells
             if c and c.strip() and c.strip().lower() != "nan"]
    if not codes:
        raise HTTPException(400, "faylda kodlar topilmadi")

    rows = _to_bartender_rows(codes)

    # CSV: no header, comma-separated, quote as-needed. UTF-8-SIG so
    # Windows Excel opens Cyrillic without a mojibake step.
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    for row in rows:
        writer.writerow(row)

    data = ("﻿" + buf.getvalue()).encode("utf-8")

    from datetime import datetime
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"BarTender_Output_{stamp}.csv"
    return Response(
        data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class GenerateInfo:
    """Sentinel — no body, this endpoint is just used to pre-flight
    the upload from the UI (count codes, preview a few) without doing
    the CSV work twice."""
    pass


@router.post("/preview")
async def preview(file: UploadFile = File(...),
                  _u: User = Depends(current_user)):
    """Return a JSON summary: total codes, first 10 codes, short-code
    flags. Lets the UI show a preview before the operator commits to
    downloading."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "fayl bo'sh")
    cells = extract_cells_from_file(file.filename or "", raw)
    codes = [c.strip() for c in cells
             if c and c.strip() and c.strip().lower() != "nan"]
    if not codes:
        raise HTTPException(400, "faylda kodlar topilmadi")
    total = len(codes)
    short = [(i + 1, c) for i, c in enumerate(codes[:2000]) if len(c) < 31]
    return {
        "total": total,
        "first": codes[:10],
        "short_count": sum(1 for c in codes if len(c) < 31),
        "short_sample": short[:20],
    }
