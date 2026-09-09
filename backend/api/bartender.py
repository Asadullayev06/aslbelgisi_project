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

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from ..auth import current_user
from ..models import User
from ..services.codes import unescape_xml_controls

router = APIRouter(prefix="/api/bartender", tags=["bartender"])

# Zero-width space — forces Excel to treat the cell as text so "1-450"
# doesn't become a date and long tokens don't become scientific notation.
_ZWSP = "​"


GS = "\x1d"   # GS1 Group Separator (U+001D) — separates a KM's AI segments


def _clean_code(s: str) -> str:
    """Normalise one raw code while KEEPING its AI separators.

    A KM's AI-91/AI-92 segments are separated by the GS control char
    (U+001D). That separator MUST survive — a printed KM DataMatrix is
    invalid without it (identity | 91<key> | 92<sig>). The bugs to fix are
    only in how the separator is *represented*:

      * Excel stores GS as the literal escape `_x001D_`; openpyxl hands it
        back either as that 7-char literal or as the real 0x1D. Unescape it
        so it becomes a real GS, never the visible text `_x001D_`.
      * Some exports render the separator as a run of spaces instead of GS.

    So: unescape `_xHHHH_` → real char, drop CR/LF/TAB (line noise that would
    break a CSV row), trim the ends, and collapse any internal run of spaces
    into a single GS. The GS itself is preserved. Result keeps the segments
    separated (`…Izkb2<GS>91UZF0<GS>92QmNP…`) exactly as the DataMatrix needs.
    """
    import re
    s = unescape_xml_controls(s)
    s = s.replace("\r", "").replace("\n", "").replace("\t", "").strip()
    # A run of spaces between segments = a separator that lost its GS on
    # export; normalise it to a real GS. (KM payloads are base64-ish and
    # never contain legitimate internal spaces.)
    s = re.sub(r" +", GS, s)
    return s


def _read_rows(name: str, raw: bytes) -> list[str]:
    """STRICT one-row-in / one-code-out reader.

    The shared `extract_cells_from_file` flattens every cell of every sheet
    and tries multiple CSV delimiters — great for pool uploads where any
    layout is fair game, but wrong for BarTender:

      * a KM code containing GS separators (rendered as spaces) got split
        into 2–3 pieces per row when the CSV sniffer picked whitespace as
        the delimiter, and
      * additional sheets in an .xlsx got concatenated.

    Here we take EXACTLY column A of the FIRST sheet (Excel), or every
    non-empty raw line (text/CSV) — no delimiter parsing at all. Whatever
    the operator wrote in each row is treated as one code, verbatim.
    """
    lname = (name or "").lower()

    if lname.endswith((".xlsx", ".xlsm", ".xls")):
        try:
            # First sheet only, ALL columns. Some .xlsx exports store one
            # KM code as three cells (identity, AI91 chunk, AI92 chunk)
            # rather than one joined cell — we want the FULL raw code either
            # way, so we walk every cell of the row and concatenate.
            df = pd.read_excel(
                io.BytesIO(raw), dtype=str,
                sheet_name=0, header=None, engine=None,
            )
        except Exception as e:
            raise HTTPException(400, f"Excel faylni o'qib bo'lmadi: {e}")
        out: list[str] = []
        for _, row in df.iterrows():
            parts: list[str] = []
            for v in row.tolist():
                if v is None:
                    continue
                s = _clean_code(str(v))
                if not s or s.lower() == "nan":
                    continue
                parts.append(s)
            if parts:
                # If the code was split across several cells (identity | AI91
                # chunk | AI92 chunk), the cell boundaries ARE the AI
                # separators, so rejoin them with a GS. A single cell already
                # carries its own GS separators from _clean_code, so this is a
                # no-op for the common one-cell-per-row file.
                joined = GS.join(parts)
                if joined:
                    out.append(joined)
        return out

    # text / csv / tsv / whatever — one line = one code, verbatim
    # (including internal delimiters and GS characters).
    #
    # DO NOT use str.splitlines() here: Python treats GS (\x1D), RS
    # (\x1E), FS (\x1C) and NEL (\x85) as line separators along with
    # \n/\r\n. KM codes use \x1D between the AI91 and AI92 segments
    # (some CSV exports render it as a visible space, some keep it
    # literal). splitlines() was shredding each KM into 3 pieces at
    # those boundaries — which is exactly what "output has 3× rows"
    # was about. Split on real newlines only.
    if isinstance(raw, bytes):
        text = raw.decode("utf-8-sig", errors="replace")
    else:
        text = raw
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        # _clean_code unescapes `_x001D_` to a real GS and KEEPS it as the AI
        # separator (normalising any space-run separator to GS too).
        s = _clean_code(line)
        if s:
            out.append(s)
    return out


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

    codes = _read_rows(file.filename or "", raw)
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
    codes = _read_rows(file.filename or "", raw)
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
