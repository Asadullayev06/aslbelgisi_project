"""Search codes across submitted projects — KM → box, SSCC → contents.

Any authenticated user can search (workers verifying inventory). Only
projects in 'submitted' status contribute results.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_session
from ..models import User
from ..services import search as svc

router = APIRouter(prefix="/api/search", tags=["search"])


class SearchRequest(BaseModel):
    codes: list[str]


class BoxOut(BaseModel):
    sscc: str
    is_loose: bool = False
    closed_at: str = ""


class ProjectRef(BaseModel):
    id: int
    name: str
    product_name: str
    series: str = ""


class SearchRow(BaseModel):
    raw: str
    kind: str                                # "km" | "sscc" | "unknown"
    canonical: str
    found: bool
    project: Optional[ProjectRef] = None
    box: Optional[BoxOut] = None
    km_status: Optional[str] = None
    km_codes: list[str] = []
    km_count: int = 0


class SearchResponse(BaseModel):
    results: list[SearchRow]
    total: int
    found: int


@router.post("", response_model=SearchResponse)
def search(body: SearchRequest,
           sess: Session = Depends(get_session),
           _u: User = Depends(current_user)):
    if not body.codes:
        raise HTTPException(400, "codes required")
    results = svc.search_codes(sess, body.codes)
    return SearchResponse(
        results=results,
        total=len(results),
        found=sum(1 for r in results if r.get("found")),
    )


@router.post("/export")
def export(body: SearchRequest,
           sess: Session = Depends(get_session),
           _u: User = Depends(current_user)):
    """Same search, delivered as an .xlsx download."""
    if not body.codes:
        raise HTTPException(400, "codes required")
    results = svc.search_codes(sess, body.codes)
    xlsx = svc.to_xlsx(results)
    return Response(
        xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="qidiruv.xlsx"'},
    )
