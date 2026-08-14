"""seed admin + 2 workers

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-14
"""
from __future__ import annotations

import bcrypt
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def upgrade() -> None:
    # 0001 inserted admin with explicit id=1 but didn't advance the sequence,
    # so a bare INSERT would also try id=1 and collide. Bump the sequence past
    # whatever's already there.
    op.execute(
        "SELECT setval(pg_get_serial_sequence('users','id'), "
        "COALESCE((SELECT MAX(id) FROM users), 1), true);"
    )

    # Admin user with id=1 already exists from 0001 (no password); replace.
    op.execute(f"""
        UPDATE users
           SET password_hash = '{_hash("admin123")}',
               role          = 'admin',
               is_active     = TRUE
         WHERE id = 1;
    """)
    op.execute(f"""
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES ('worker1', '{_hash("worker123")}', 'operator', TRUE)
        ON CONFLICT (username) DO NOTHING;
    """)
    op.execute(f"""
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES ('worker2', '{_hash("worker123")}', 'operator', TRUE)
        ON CONFLICT (username) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM users WHERE username IN ('worker1','worker2');")
    op.execute("UPDATE users SET password_hash='' WHERE id=1;")
