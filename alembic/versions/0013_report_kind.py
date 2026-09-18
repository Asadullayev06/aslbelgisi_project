"""Reporting: per-project scan kind (km | sscc | mixed).

A reporting project now declares what it accepts. Existing rows default to
'sscc' because that's what the operator has been scanning until now.

Idempotent — safe to re-apply.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-18
"""
from __future__ import annotations

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS report_kind TEXT NOT NULL DEFAULT 'sscc'
    """)
    # Only reporting rows can carry a meaningful value; other modes stay at the
    # default and the API ignores it. Constrain the allowed set.
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_report_kind")
    op.execute("""
        ALTER TABLE projects
        ADD CONSTRAINT ck_projects_report_kind
        CHECK (report_kind IN ('km','sscc','mixed'))
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_report_kind")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS report_kind")
