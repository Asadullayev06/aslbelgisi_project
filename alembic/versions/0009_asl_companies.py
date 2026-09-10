"""Saved ASL company credentials (name + INN + API key).

A small keeper so operators pick a saved company in the "Kompaniya
autentifikatsiyasi" step instead of retyping the INN + API key each time.

Idempotent — safe to re-apply.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-10
"""
from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS asl_companies (
            id          BIGSERIAL PRIMARY KEY,
            name        TEXT NOT NULL,
            inn         TEXT NOT NULL DEFAULT '',
            api_key     TEXT NOT NULL DEFAULT '',
            created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_asl_companies_name UNIQUE (name)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS asl_companies")
