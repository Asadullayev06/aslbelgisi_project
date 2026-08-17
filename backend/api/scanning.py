"""Scanning endpoints.

Auth: everything requires login. Delete-box is admin-only (operator can
undo their in-progress box via /discard, but only admin can undo a closed one).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import User
from ..schemas import LooseModeRequest, ScanRequest, ScanResponse
from ..services import scanning
from ..services import project_analysis
from .state import build_state

router = APIRouter(prefix="/api/projects/{project_id}", tags=["scanning"])


def _wrap(res: dict, sess: Session, project_id: int, user_id: int) -> ScanResponse:
    try:
        state = build_state(sess, project_id, user_id)
    except LookupError:
        raise HTTPException(404, "loyiha topilmadi")
    return ScanResponse(
        level=res["level"], message=res["message"],
        kind=res.get("kind"), code=res.get("code"), state=state,
    )


@router.post("/scan", response_model=ScanResponse)
def scan(project_id: int, body: ScanRequest,
         sess: Session = Depends(get_session),
         u: User = Depends(current_user)):
    if not body.code.strip():
        raise HTTPException(400, "code required")
    try:
        res = scanning.scan_code(sess, project_id, u.id, body.code,
                                 attempt=body.attempt)
    except ValueError as e:
        res = {"level": "err", "message": str(e)}
    return _wrap(res, sess, project_id, u.id)


@router.post("/undo", response_model=ScanResponse)
def undo(project_id: int,
         sess: Session = Depends(get_session),
         u: User = Depends(current_user)):
    res = scanning.undo_last(sess, project_id, u.id)
    return _wrap(res, sess, project_id, u.id)


@router.post("/discard", response_model=ScanResponse)
def discard(project_id: int,
            sess: Session = Depends(get_session),
            u: User = Depends(current_user)):
    res = scanning.discard_open(sess, project_id, u.id)
    return _wrap(res, sess, project_id, u.id)


@router.post("/loose-mode", response_model=ScanResponse)
def loose_mode(project_id: int, body: LooseModeRequest,
               sess: Session = Depends(get_session),
               u: User = Depends(current_user)):
    res = scanning.set_loose_mode(sess, project_id, u.id, body.on)
    return _wrap(res, sess, project_id, u.id)


@router.delete("/boxes/{box_id}", response_model=ScanResponse)
def delete_box(project_id: int, box_id: int,
               sess: Session = Depends(get_session),
               u: User = Depends(require_admin)):
    res = scanning.delete_box(sess, project_id, box_id)
    return _wrap(res, sess, project_id, u.id)


@router.post("/analyze")
def analyze(project_id: int,
            sess: Session = Depends(get_session),
            _u: User = Depends(current_user)):
    """Read-only quality analysis of the project. Optional — the operator
    triggers it from the 'AI Tahlil' button on the scan page. No mutations,
    no ASL calls."""
    try:
        return project_analysis.analyze_project(sess, project_id)
    except LookupError:
        from fastapi import HTTPException
        raise HTTPException(404, "loyiha topilmadi")
