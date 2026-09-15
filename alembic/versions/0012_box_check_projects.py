"""Box-check module: promote to a project-based mode like Inventory.

Each product/series is now its own `Project(mode='box_check')` with the
company INN + API key stored on the project row (reusing the existing
`asl_check_inn` / `asl_check_api_key` columns). One audit ("box_checks"
row) belongs to a project via a new `project_id` FK.

Idempotent — safe to re-apply.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-15
"""
from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend the CHECK constraint on projects.mode to allow the new value.
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_mode")
    op.execute("""
        ALTER TABLE projects
        ADD CONSTRAINT ck_projects_mode
        CHECK (mode IN ('aggregation','inventory','reporting','box_check'))
    """)

    # Bind every box audit to a project. Nullable so pre-existing rows keep
    # working; the API forces it on all new inserts.
    op.execute("""
        ALTER TABLE box_checks
        ADD COLUMN IF NOT EXISTS project_id BIGINT
        REFERENCES projects(id) ON DELETE CASCADE
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_box_checks_project
        ON box_checks (project_id, opened_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_box_checks_project")
    op.execute("ALTER TABLE box_checks DROP COLUMN IF EXISTS project_id")
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_mode")
    op.execute("""
        ALTER TABLE projects
        ADD CONSTRAINT ck_projects_mode
        CHECK (mode IN ('aggregation','inventory','reporting'))
    """)
