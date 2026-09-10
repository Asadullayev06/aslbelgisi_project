"""Saved ASL company credentials — the INN + API key keeper.

Any authenticated user can list and use them (the auth step needs the key
to run a query); this is a trusted internal tool. The API key is stored
server-side and returned to authenticated clients, which then send it in the
existing verify/register/scan flows.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_session
from ..models import AslCompany, User

router = APIRouter(prefix="/api/asl-companies", tags=["asl-companies"])


class CompanyIn(BaseModel):
    name: str = Field(min_length=1)
    inn: str = ""
    api_key: str = ""


class CompanyPatch(BaseModel):
    name: str | None = None
    inn: str | None = None
    api_key: str | None = None


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    inn: str
    api_key: str
    updated_at: datetime


@router.get("", response_model=list[CompanyOut])
def list_companies(sess: Session = Depends(get_session),
                   _u: User = Depends(current_user)):
    rows = sess.execute(select(AslCompany).order_by(AslCompany.name.asc())).scalars()
    return list(rows)


@router.post("", response_model=CompanyOut, status_code=201)
def create_company(body: CompanyIn,
                   sess: Session = Depends(get_session),
                   u: User = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "kompaniya nomi kerak")
    c = AslCompany(name=name, inn=body.inn.strip(), api_key=body.api_key.strip(),
                   created_by=u.id)
    sess.add(c)
    try:
        sess.commit()
    except IntegrityError:
        sess.rollback()
        raise HTTPException(409, "bu nom bilan kompaniya allaqachon saqlangan")
    sess.refresh(c)
    return c


@router.patch("/{company_id}", response_model=CompanyOut)
def update_company(company_id: int, body: CompanyPatch,
                   sess: Session = Depends(get_session),
                   _u: User = Depends(current_user)):
    c = sess.get(AslCompany, company_id)
    if c is None:
        raise HTTPException(404, "kompaniya topilmadi")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(400, "kompaniya nomi bo'sh bo'lolmaydi")
        c.name = n
    if body.inn is not None:
        c.inn = body.inn.strip()
    if body.api_key is not None:
        c.api_key = body.api_key.strip()
    c.updated_at = datetime.now(timezone.utc)
    try:
        sess.commit()
    except IntegrityError:
        sess.rollback()
        raise HTTPException(409, "bu nom bilan kompaniya allaqachon saqlangan")
    sess.refresh(c)
    return c


@router.delete("/{company_id}", status_code=204)
def delete_company(company_id: int,
                   sess: Session = Depends(get_session),
                   _u: User = Depends(current_user)):
    c = sess.get(AslCompany, company_id)
    if c is None:
        raise HTTPException(404, "kompaniya topilmadi")
    sess.delete(c)
    sess.commit()
    return None
