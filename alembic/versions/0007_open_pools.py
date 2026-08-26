"""add projects.open_km_pool + projects.open_box_pool

For aggregation projects created without uploading the KM or SSCC
manifest, these flags stay TRUE forever so the scanning path knows to
auto-register unknown codes instead of rejecting them as 'not in list'.

Idempotent — safe to re-apply.

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-24
"""
from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS open_km_pool  BOOLEAN NOT NULL DEFAULT FALSE
    """)
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS open_box_pool BOOLEAN NOT NULL DEFAULT FALSE
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS open_box_pool")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS open_km_pool")
