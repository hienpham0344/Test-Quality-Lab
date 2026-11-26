"""Metric provenance: formula, tool name/version, parameters and input hashes (#57, NFR-REP-001)."""

import sqlalchemy as sa
from alembic import op

revision = "20261127_0015"
down_revision = "20261127_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("metric_records", sa.Column("provenance", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("metric_records", "provenance")
