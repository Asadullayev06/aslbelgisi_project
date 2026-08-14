"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("username", sa.Text, nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False, server_default=""),
        sa.Column("role", sa.Text, nullable=False, server_default="admin"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('admin','operator')", name="ck_users_role"),
    )

    op.create_table(
        "projects",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("product_name", sa.Text, nullable=False),
        sa.Column("total_boxes", sa.Integer, nullable=False),
        sa.Column("per_box", sa.Integer, nullable=False),
        sa.Column("has_loose", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("loose_qty", sa.Integer, nullable=False, server_default="0"),
        sa.Column("business_place_id", sa.Text, nullable=False),
        sa.Column("production_order_id", sa.Text, nullable=False, server_default=""),
        sa.Column("status", sa.Text, nullable=False, server_default="active"),
        sa.Column("created_by", sa.BigInteger,
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("total_boxes > 0",  name="ck_projects_total_boxes_pos"),
        sa.CheckConstraint("per_box > 0",      name="ck_projects_per_box_pos"),
        sa.CheckConstraint("loose_qty >= 0",   name="ck_projects_loose_nn"),
        sa.CheckConstraint("NOT has_loose OR loose_qty > 0",
                           name="ck_projects_loose_requires_qty"),
        sa.CheckConstraint("status IN ('active','submitting','submitted','archived')",
                           name="ck_projects_status"),
    )

    op.create_table(
        "open_boxes",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("project_id", sa.BigInteger,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger,
                  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("is_loose", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("short_close_pending", sa.Boolean, nullable=False,
                  server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("project_id", "user_id", name="uq_open_boxes_project_user"),
    )

    op.create_table(
        "boxes",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("project_id", sa.BigInteger,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sscc", sa.Text, nullable=False),
        sa.Column("capacity", sa.Integer, nullable=False),
        sa.Column("is_loose", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("closed_by", sa.BigInteger,
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("project_id", "sscc", name="uq_boxes_project_sscc"),
    )
    op.execute("CREATE UNIQUE INDEX ux_boxes_one_loose "
               "ON boxes (project_id) WHERE is_loose;")

    op.create_table(
        "km_pool",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("project_id", sa.BigInteger,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("km_code", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("claimed_by", sa.BigInteger,
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("open_box_id", sa.BigInteger,
                  sa.ForeignKey("open_boxes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("box_id", sa.BigInteger,
                  sa.ForeignKey("boxes.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("project_id", "km_code", name="uq_km_pool_project_km"),
        sa.CheckConstraint("status IN ('pending','claimed','aggregated')",
                           name="ck_km_pool_status"),
    )
    op.create_index("ix_km_project_status", "km_pool", ["project_id", "status"])
    op.execute("CREATE INDEX ix_km_open_box ON km_pool (open_box_id) "
               "WHERE open_box_id IS NOT NULL;")
    op.execute("CREATE INDEX ix_km_box ON km_pool (box_id) "
               "WHERE box_id IS NOT NULL;")

    op.create_table(
        "box_pool",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("project_id", sa.BigInteger,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sscc", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("used_by", sa.BigInteger,
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("project_id", "sscc", name="uq_box_pool_project_sscc"),
        sa.CheckConstraint("status IN ('pending','used')", name="ck_box_pool_status"),
    )
    op.create_index("ix_boxpool_project_status", "box_pool", ["project_id", "status"])

    op.create_table(
        "submissions",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("project_id", sa.BigInteger,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_index", sa.Integer, nullable=False),
        sa.Column("unit_count", sa.Integer, nullable=False),
        sa.Column("code_count", sa.Integer, nullable=False),
        sa.Column("http_status", sa.Integer, nullable=True),
        sa.Column("document_id", sa.Text, nullable=True),
        sa.Column("ok", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("document_body", sa.Text, nullable=True),
        sa.Column("submitted_by", sa.BigInteger,
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("project_id", "report_index",
                            name="uq_submissions_project_report"),
    )

    # Seed the default admin for v1 (single-user).
    op.execute("INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin') "
               "ON CONFLICT (id) DO NOTHING;")


def downgrade() -> None:
    op.drop_table("submissions")
    op.drop_index("ix_boxpool_project_status", table_name="box_pool")
    op.drop_table("box_pool")
    op.execute("DROP INDEX IF EXISTS ix_km_box;")
    op.execute("DROP INDEX IF EXISTS ix_km_open_box;")
    op.drop_index("ix_km_project_status", table_name="km_pool")
    op.drop_table("km_pool")
    op.execute("DROP INDEX IF EXISTS ux_boxes_one_loose;")
    op.drop_table("boxes")
    op.drop_table("open_boxes")
    op.drop_table("projects")
    op.drop_table("users")
