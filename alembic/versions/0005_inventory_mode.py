"""add inventory mode: projects.mode, km_pool.series, relaxed constraints

Inventory mode is a separate workflow for warehouse counting — same physical
UI as aggregation but with multiple series per project, free-form box sizes,
extras allowed (codes scanned that weren't in the manifest), and no ASL
submission.

This migration is deliberately idempotent — the columns and constraints
were accidentally seeded into prod by a test script whose DDL commit was
not properly rolled back, and the safest recovery is to make every step
work whether it has already been applied or not.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-17
"""
from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- projects.mode ----
    op.execute("""
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'aggregation'
    """)
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_projects_mode') THEN
            ALTER TABLE projects
            ADD CONSTRAINT ck_projects_mode CHECK (mode IN ('aggregation','inventory'));
          END IF;
        END $$
    """)

    # ---- relax capacity checks (drop >0, replace with >=0) ----
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_total_boxes_pos")
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_per_box_pos")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_projects_total_boxes_nn') THEN
            ALTER TABLE projects
            ADD CONSTRAINT ck_projects_total_boxes_nn CHECK (total_boxes >= 0);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_projects_per_box_nn') THEN
            ALTER TABLE projects
            ADD CONSTRAINT ck_projects_per_box_nn CHECK (per_box >= 0);
          END IF;
        END $$
    """)

    # ---- km_pool.series + widen uniqueness ----
    op.execute("""
        ALTER TABLE km_pool
        ADD COLUMN IF NOT EXISTS series TEXT NOT NULL DEFAULT ''
    """)
    op.execute("ALTER TABLE km_pool DROP CONSTRAINT IF EXISTS uq_km_pool_project_km")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname='uq_km_pool_project_km_series') THEN
            ALTER TABLE km_pool
            ADD CONSTRAINT uq_km_pool_project_km_series
              UNIQUE (project_id, km_code, series);
          END IF;
        END $$
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_km_project_code
        ON km_pool (project_id, km_code)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_km_project_code")
    op.execute("ALTER TABLE km_pool DROP CONSTRAINT IF EXISTS uq_km_pool_project_km_series")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_km_pool_project_km') THEN
            ALTER TABLE km_pool ADD CONSTRAINT uq_km_pool_project_km UNIQUE (project_id, km_code);
          END IF;
        END $$
    """)
    op.execute("ALTER TABLE km_pool DROP COLUMN IF EXISTS series")

    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_per_box_nn")
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_total_boxes_nn")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_projects_per_box_pos') THEN
            ALTER TABLE projects ADD CONSTRAINT ck_projects_per_box_pos CHECK (per_box > 0);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_projects_total_boxes_pos') THEN
            ALTER TABLE projects ADD CONSTRAINT ck_projects_total_boxes_pos CHECK (total_boxes > 0);
          END IF;
        END $$
    """)
    op.execute("ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_mode")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS mode")
