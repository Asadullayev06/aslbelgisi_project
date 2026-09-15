"""Box-check module: audit a box's contents against ASL Belgisi's records.

Operator scans an SSCC first; ASL owner-check verifies the box belongs to
the given INN and returns its child KMs. Every KM the operator then scans
is compared against that expected set — matches / duplicates / extras are
tracked, and the whole audit persists so a reload / crash never drops it.

Idempotent — safe to re-apply.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-15
"""
from __future__ import annotations

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One "audit session" = one box the operator is verifying.
    op.execute("""
        CREATE TABLE IF NOT EXISTS box_checks (
            id            BIGSERIAL PRIMARY KEY,
            created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
            company_name  TEXT NOT NULL DEFAULT '',
            owner_inn     TEXT NOT NULL DEFAULT '',
            api_key       TEXT NOT NULL DEFAULT '',
            sscc          TEXT NOT NULL,                 -- 20-char canonical
            expected_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            expected_count INTEGER NOT NULL DEFAULT 0,
            product_name  TEXT NOT NULL DEFAULT '',
            gtin          TEXT NOT NULL DEFAULT '',
            package_type  TEXT NOT NULL DEFAULT '',
            status        TEXT NOT NULL DEFAULT 'active',
                                                        -- active | closed_ok |
                                                        -- closed_mismatch | abandoned
            opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_at     TIMESTAMPTZ,
            CONSTRAINT ck_box_checks_status
              CHECK (status IN ('active','closed_ok','closed_mismatch','abandoned'))
        )
    """)
    # At most one active audit per (user, sscc) — an operator picking the same
    # box up again reopens the existing one instead of forking a second copy.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_box_checks_active_user_sscc
        ON box_checks (created_by, sscc)
        WHERE status = 'active'
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_box_checks_created_by
        ON box_checks (created_by, opened_at DESC)
    """)

    # Every KM scan the operator makes against a box_check — verdict tells us
    # whether it matched, was already seen in this check, or wasn't in ASL's
    # expected list.  Kept append-only for audit.
    op.execute("""
        CREATE TABLE IF NOT EXISTS box_check_scans (
            id           BIGSERIAL PRIMARY KEY,
            box_check_id BIGINT NOT NULL REFERENCES box_checks(id) ON DELETE CASCADE,
            code         TEXT NOT NULL,                   -- 31-char canonical KM
            verdict      TEXT NOT NULL,                   -- match | duplicate | extra | unknown
            raw          TEXT NOT NULL DEFAULT '',
            scanned_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
            scanned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_box_check_scans_verdict
              CHECK (verdict IN ('match','duplicate','extra','unknown'))
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_box_check_scans_check
        ON box_check_scans (box_check_id, scanned_at)
    """)
    # A KM can only be counted as a "match" once inside one audit; a repeat is
    # a 'duplicate' row instead. Enforce that at the DB layer for match rows only.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_box_check_scans_match_once
        ON box_check_scans (box_check_id, code)
        WHERE verdict = 'match'
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS box_check_scans")
    op.execute("DROP TABLE IF EXISTS box_checks")
