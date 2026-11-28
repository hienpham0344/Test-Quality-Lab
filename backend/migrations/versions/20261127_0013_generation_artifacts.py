"""Generation raw-response metadata, parsed artifact, validation stages and job error summary (#39, #40, #41)."""

import sqlalchemy as sa
from alembic import op

revision = "20261127_0013"
down_revision = "20261127_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("generation_runs", sa.Column("response_metadata", sa.JSON(), nullable=True))
    op.add_column("generation_runs", sa.Column("parsed_code", sa.Text(), nullable=True))
    op.add_column("generation_runs", sa.Column("validation", sa.JSON(), nullable=True))
    op.add_column("generation_jobs", sa.Column("error_summary", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("generation_jobs", "error_summary")
    op.drop_column("generation_runs", "validation")
    op.drop_column("generation_runs", "parsed_code")
    op.drop_column("generation_runs", "response_metadata")
