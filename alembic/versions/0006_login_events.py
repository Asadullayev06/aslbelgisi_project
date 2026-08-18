"""add login_events audit table

Every login attempt — success or failure — is recorded so admin can see
who visited the platform, when, from which browser / IP, and why any
failed attempts failed.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_events",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("user_id", sa.BigInteger,
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("username_tried", sa.Text, nullable=False, server_default=""),
        sa.Column("device_id",  sa.Text, nullable=False, server_default=""),
        sa.Column("ip",         sa.Text, nullable=False, server_default=""),
        sa.Column("user_agent", sa.Text, nullable=False, server_default=""),
        sa.Column("success",    sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("reason",     sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_login_events_created", "login_events", ["created_at"])
    op.create_index("ix_login_events_user",    "login_events", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_login_events_user",    table_name="login_events")
    op.drop_index("ix_login_events_created", table_name="login_events")
    op.drop_table("login_events")
