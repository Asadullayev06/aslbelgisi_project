"""ORM models — mirror plan.md §3 exactly so multi-user work slots in later."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# ── enums (as plain string constants; DB check-constraints enforce them) ──
KM_STATUSES     = ("pending", "claimed", "aggregated")
BOX_STATUSES    = ("pending", "used")
PROJECT_STATUS  = ("active", "submitting", "submitted", "archived")
USER_ROLES      = ("admin", "operator")


class User(Base):
    __tablename__ = "users"
    id:            Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    username:      Mapped[str]      = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str]      = mapped_column(Text, nullable=False, default="")
    role:          Mapped[str]      = mapped_column(Text, nullable=False, default="admin")
    is_active:     Mapped[bool]     = mapped_column(Boolean, nullable=False, default=True)
    created_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                    server_default=func.now(),
                                                    nullable=False)
    __table_args__ = (
        CheckConstraint(f"role IN {USER_ROLES!r}", name="ck_users_role"),
    )


class Project(Base):
    __tablename__ = "projects"
    id:                  Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    name:                Mapped[str]      = mapped_column(Text, nullable=False)
    product_name:        Mapped[str]      = mapped_column(Text, nullable=False)
    total_boxes:         Mapped[int]      = mapped_column(Integer, nullable=False)
    per_box:             Mapped[int]      = mapped_column(Integer, nullable=False)
    has_loose:           Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    loose_qty:           Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    business_place_id:   Mapped[str]      = mapped_column(Text, nullable=False, default="")
    production_order_id: Mapped[str]      = mapped_column(Text, nullable=False, default="")
    status:              Mapped[str]      = mapped_column(Text, nullable=False, default="active")
    created_by:          Mapped[Optional[int]] = mapped_column(BigInteger,
                                                    ForeignKey("users.id", ondelete="SET NULL"),
                                                    nullable=True)
    created_at:          Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                    server_default=func.now(), nullable=False)
    __table_args__ = (
        CheckConstraint("total_boxes > 0", name="ck_projects_total_boxes_pos"),
        CheckConstraint("per_box > 0",     name="ck_projects_per_box_pos"),
        CheckConstraint("loose_qty >= 0",  name="ck_projects_loose_nn"),
        CheckConstraint("NOT has_loose OR loose_qty > 0", name="ck_projects_loose_requires_qty"),
        CheckConstraint(f"status IN {PROJECT_STATUS!r}", name="ck_projects_status"),
    )

    @property
    def full_boxes(self) -> int:
        return self.total_boxes - (1 if self.has_loose else 0)

    @property
    def planned_km(self) -> int:
        return self.full_boxes * self.per_box + (self.loose_qty if self.has_loose else 0)


class OpenBox(Base):
    """One in-progress box per (project, user). UNIQUE enforces that."""
    __tablename__ = "open_boxes"
    id:         Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("projects.id", ondelete="CASCADE"),
                                        nullable=False)
    user_id:    Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("users.id"), nullable=False)
    is_loose:   Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    short_close_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                        server_default=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_open_boxes_project_user"),
    )


class Box(Base):
    """A closed box."""
    __tablename__ = "boxes"
    id:         Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("projects.id", ondelete="CASCADE"),
                                        nullable=False)
    sscc:       Mapped[str]      = mapped_column(Text, nullable=False)
    capacity:   Mapped[int]      = mapped_column(Integer, nullable=False)
    is_loose:   Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    closed_by:  Mapped[Optional[int]] = mapped_column(BigInteger,
                                        ForeignKey("users.id", ondelete="SET NULL"),
                                        nullable=True)
    closed_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                        server_default=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("project_id", "sscc", name="uq_boxes_project_sscc"),
        Index("ux_boxes_one_loose", "project_id",
              unique=True, postgresql_where=(is_loose)),  # only ONE loose box per project
    )


class KmPool(Base):
    __tablename__ = "km_pool"
    id:          Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    project_id:  Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("projects.id", ondelete="CASCADE"),
                                        nullable=False)
    km_code:     Mapped[str]      = mapped_column(Text, nullable=False)  # canonical 31 chars
    status:      Mapped[str]      = mapped_column(Text, nullable=False, default="pending")
    claimed_by:  Mapped[Optional[int]] = mapped_column(BigInteger,
                                        ForeignKey("users.id"), nullable=True)
    claimed_at:  Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    open_box_id: Mapped[Optional[int]] = mapped_column(BigInteger,
                                        ForeignKey("open_boxes.id", ondelete="SET NULL"),
                                        nullable=True)
    box_id:      Mapped[Optional[int]] = mapped_column(BigInteger,
                                        ForeignKey("boxes.id", ondelete="SET NULL"),
                                        nullable=True)
    __table_args__ = (
        UniqueConstraint("project_id", "km_code", name="uq_km_pool_project_km"),
        CheckConstraint(f"status IN {KM_STATUSES!r}", name="ck_km_pool_status"),
        Index("ix_km_project_status", "project_id", "status"),
        Index("ix_km_open_box", "open_box_id"),
        Index("ix_km_box", "box_id"),
    )


class BoxPool(Base):
    __tablename__ = "box_pool"
    id:         Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("projects.id", ondelete="CASCADE"),
                                        nullable=False)
    sscc:       Mapped[str]      = mapped_column(Text, nullable=False)   # normalized 20 chars
    status:     Mapped[str]      = mapped_column(Text, nullable=False, default="pending")
    used_by:    Mapped[Optional[int]] = mapped_column(BigInteger,
                                        ForeignKey("users.id"), nullable=True)
    used_at:    Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        UniqueConstraint("project_id", "sscc", name="uq_box_pool_project_sscc"),
        CheckConstraint(f"status IN {BOX_STATUSES!r}", name="ck_box_pool_status"),
        Index("ix_boxpool_project_status", "project_id", "status"),
    )


class ScanEvent(Base):
    """Append-only record of every barcode the system was asked to accept.

    Exists so "the operator scanned 150 but only 148 landed" is always
    answerable. Written in bulk once per batch, so it costs one statement.
    """
    __tablename__ = "scan_events"
    id:         Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("projects.id", ondelete="CASCADE"),
                                        nullable=False)
    user_id:    Mapped[Optional[int]] = mapped_column(BigInteger,
                                        ForeignKey("users.id", ondelete="SET NULL"),
                                        nullable=True)
    raw_code:   Mapped[str]      = mapped_column(Text, nullable=False, default="")
    km_code:    Mapped[str]      = mapped_column(Text, nullable=False, default="")
    level:      Mapped[str]      = mapped_column(Text, nullable=False)   # hit | err | warn
    reason:     Mapped[str]      = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                        server_default=func.now(), nullable=False)
    __table_args__ = (
        Index("ix_scan_events_project_time", "project_id", "created_at"),
        Index("ix_scan_events_project_level", "project_id", "level"),
    )


class Submission(Base):
    """One row per ASL report request. Written BEFORE the network call for
    crash-safety, updated after."""
    __tablename__ = "submissions"
    id:            Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    project_id:    Mapped[int]      = mapped_column(BigInteger,
                                        ForeignKey("projects.id", ondelete="CASCADE"),
                                        nullable=False)
    report_index:  Mapped[int]      = mapped_column(Integer, nullable=False)
    unit_count:    Mapped[int]      = mapped_column(Integer, nullable=False)
    code_count:    Mapped[int]      = mapped_column(Integer, nullable=False)
    http_status:   Mapped[Optional[int]]  = mapped_column(Integer, nullable=True)
    document_id:   Mapped[Optional[str]]  = mapped_column(Text,    nullable=True)
    ok:            Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    error:         Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    document_body: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    submitted_by:  Mapped[Optional[int]]  = mapped_column(BigInteger,
                                        ForeignKey("users.id"), nullable=True)
    created_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                        server_default=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("project_id", "report_index", name="uq_submissions_project_report"),
    )
