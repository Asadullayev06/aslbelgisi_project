"""Validate + submit.

Auth:
  validate — any logged-in user (workers can see readiness too).
  submit   — admin only. The one-click mass aggregation to ASL Belgisi.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import User
from ..schemas import SubmitRequest, SubmitResponse, ValidateResult
from ..services import asl_client

router = APIRouter(prefix="/api/projects/{project_id}", tags=["submissions"])


@router.post("/validate", response_model=ValidateResult)
def validate(project_id: int,
             sess: Session = Depends(get_session),
             _u: User = Depends(current_user)):
    return asl_client.validate_ready(sess, project_id)


@router.post("/submit", response_model=SubmitResponse)
def submit(project_id: int, body: SubmitRequest,
           sess: Session = Depends(get_session),
           u: User = Depends(require_admin)):
    result = asl_client.submit_project(
        sess, project_id, u.id, api_key=body.api_key,
        business_place_id=body.business_place_id,
        production_order_id=body.production_order_id,
    )
    if not result.get("ok") and "reports" not in result:
        return SubmitResponse(ok=False, error=result.get("error", ""))
    return SubmitResponse(
        ok=result["ok"],
        reports=result.get("reports", []),
        total_reports=result.get("total_reports", 0),
    )
