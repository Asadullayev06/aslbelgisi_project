"""Inventory ASL ownership gate: per-project ASL creds + a verdict cache.

Adds three columns to `projects` so an inventory loyiha can be created in
"ASL egalik tekshiruvi" mode (validate each scanned code against ASL 9.3
nested-codes/owner-check), plus a cache table so a code is only checked
against ASL once per loyiha.

Idempotent — safe to re-apply.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-07
"""
from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS asl_check_enabled BOOLEAN NOT NULL DEFAULT FALSE
    """)
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS asl_check_inn TEXT NOT NULL DEFAULT ''
    """)
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS asl_check_api_key TEXT NOT NULL DEFAULT ''
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS asl_ownership_checks (
            id           BIGSERIAL PRIMARY KEY,
            project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            km_code      TEXT NOT NULL,
            verdict      TEXT NOT NULL,       -- owned | forbidden | missing
            checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_asl_checks_project_code UNIQUE (project_id, km_code),
            CONSTRAINT ck_asl_checks_verdict CHECK (verdict IN ('owned','forbidden','missing'))
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_asl_checks_project
        ON asl_ownership_checks (project_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS asl_ownership_checks")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS asl_check_api_key")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS asl_check_inn")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS asl_check_enabled")
