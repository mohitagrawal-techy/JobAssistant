"""google profile details

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(200)))
    op.add_column("users", sa.Column("picture_url", sa.String(1000)))


def downgrade() -> None:
    op.drop_column("users", "picture_url")
    op.drop_column("users", "full_name")
