"""Validate + submit.

Auth:
  validate — any logged-in user (workers can see readiness too).
  submit   — admin only. The one-click mass aggregation to ASL Belgisi.
  resubmit — admin only. Re-sends a project already in 'submitted' state
             (used when the wrong company's credentials were sent the first
             time). Refuses to touch active/submitting projects.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete, text as sa_text
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_session
from ..models import Submission, User
from ..schemas import SubmitRequest, SubmitResponse, ValidateResult
from ..services import asl_client

router = APIRouter(prefix="/api/projects/{project_id}", tags=["submissions"])


@router.post("/validate", response_model=ValidateResult)
def validate(project_id: int,
             sess: Session = Depends(get_session),
             _u: User = Depends(current_user)):
    return asl_client.validate_ready(sess, project_id)


def _wrap_submit_result(result: dict) -> SubmitResponse:
    if not result.get("ok") and "reports" not in result:
        return SubmitResponse(ok=False, error=result.get("error", ""))
    return SubmitResponse(
        ok=result["ok"],
        reports=result.get("reports", []),
        total_reports=result.get("total_reports", 0),
    )


@router.post("/submit", response_model=SubmitResponse)
def submit(project_id: int, body: SubmitRequest,
           sess: Session = Depends(get_session),
           u: User = Depends(require_admin)):
    result = asl_client.submit_project(
        sess, project_id, u.id, api_key=body.api_key,
        business_place_id=body.business_place_id,
        production_order_id=body.production_order_id,
    )
    return _wrap_submit_result(result)


@router.post("/resubmit", response_model=SubmitResponse)
def resubmit(project_id: int, body: SubmitRequest,
             sess: Session = Depends(get_session),
             u: User = Depends(require_admin)):
    """Re-send a project already marked 'submitted'.

    Guarded strictly to prevent accidental double-submission of a project the
    operator is still working on:
      * Only 'submitted' projects are eligible. active / submitting / archived
        are refused with a message naming the current status.
      * The status flip is atomic (single UPDATE with the status in WHERE);
        two concurrent resubmit calls cannot both succeed.
      * Previous Submission rows are deleted so submit_project's idempotency
        check does not skip them as 'already ok=True'. The ASL-side documents
        are unaffected — the caller should have voided them on ASL first.

    Boxes, KM pool, closed-box grid — none of that is touched. Only the
    project's status flag and its submissions log.
    """
    # Atomic guard: only flip submitted -> active. If another admin is already
    # resubmitting, or the project moved on, this returns zero rows.
    row = sess.execute(
        sa_text("UPDATE projects SET status='active' "
                "WHERE id=:pid AND status='submitted' RETURNING id"),
        {"pid": project_id},
    ).first()
    if row is None:
        cur = sess.execute(
            sa_text("SELECT status FROM projects WHERE id=:pid"),
            {"pid": project_id},
        ).scalar_one_or_none()
        if cur is None:
            raise HTTPException(404, "loyiha topilmadi")
        raise HTTPException(
            400,
            f"qayta yuborish faqat 'submitted' holatidagi loyiha uchun — "
            f"hozirgi holat: '{cur}'",
        )
    # Clear the log AFTER the guard grants us exclusive right to the flip.
    sess.execute(sa_delete(Submission).where(Submission.project_id == project_id))
    sess.commit()

    # Now the normal path — same code as /submit, so if it succeeds status
    # goes back to 'submitted'; if it fails it's left 'active' and can be
    # re-run.
    result = asl_client.submit_project(
        sess, project_id, u.id, api_key=body.api_key,
        business_place_id=body.business_place_id,
        production_order_id=body.production_order_id,
    )
    return _wrap_submit_result(result)
