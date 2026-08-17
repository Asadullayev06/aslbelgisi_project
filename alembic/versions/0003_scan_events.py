"""scan_events audit log

Every barcode the system was asked to accept is recorded here with its
verdict, so a discrepancy between what an operator scanned and what landed
in km_pool is always explainable after the fact.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scan_events",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("project_id", sa.BigInteger,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger,
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("raw_code", sa.Text, nullable=False, server_default=""),
        sa.Column("km_code", sa.Text, nullable=False, server_default=""),
        sa.Column("level", sa.Text, nullable=False),
        sa.Column("reason", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_scan_events_project_time", "scan_events",
                    ["project_id", "created_at"])
    op.create_index("ix_scan_events_project_level", "scan_events",
                    ["project_id", "level"])


def downgrade() -> None:
    op.drop_index("ix_scan_events_project_level", table_name="scan_events")
    op.drop_index("ix_scan_events_project_time", table_name="scan_events")
    op.drop_table("scan_events")
