"""add series column to projects

Batch / seriya identifier — required for projects created from now on,
empty string on any project created before.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("series", sa.Text, nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("projects", "series")
