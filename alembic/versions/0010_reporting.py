"""Reporting module: one project per series, flat scanned-codes list.

Reporting projects sit alongside aggregation + inventory. Each project = one
series (grouped by product like the others). Scans go into a single flat
list keyed by canonical code, and duplicates within THIS series are the only
guard — no boxes, no capacity, no manifest, no ASL check.

Idempotent — safe to re-apply.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-14
"""
from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New mode value: extend the CHECK constraint on projects.mode.
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_mode")
    op.execute("""
        ALTER TABLE projects
        ADD CONSTRAINT ck_projects_mode
        CHECK (mode IN ('aggregation','inventory','reporting'))
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS report_scans (
            id          BIGSERIAL PRIMARY KEY,
            project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            code        TEXT NOT NULL,      -- canonical: 31-char KM or 20-char SSCC
            kind        TEXT NOT NULL,      -- 'km' | 'sscc'
            raw         TEXT NOT NULL DEFAULT '',
            scanned_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
            scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_report_scans_project_code UNIQUE (project_id, code),
            CONSTRAINT ck_report_scans_kind CHECK (kind IN ('km','sscc'))
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_report_scans_project_time
        ON report_scans (project_id, scanned_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS report_scans")
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_mode")
    op.execute("""
        ALTER TABLE projects
        ADD CONSTRAINT ck_projects_mode
        CHECK (mode IN ('aggregation','inventory'))
    """)
