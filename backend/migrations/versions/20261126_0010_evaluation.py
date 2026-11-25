"""Evaluation metric records and human assertion rubric reviews."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_0010"
down_revision = "20261126_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "metric_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "snapshot_id",
            sa.Uuid(),
            sa.ForeignKey("experiment_snapshots.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("metric_name", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("numeric_value", sa.Float(), nullable=True),
        sa.Column("numerator", sa.Integer(), nullable=True),
        sa.Column("denominator", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "metric_name"),
    )
    op.create_index("ix_metric_records_project_id", "metric_records", ["project_id"])
    op.create_index("ix_metric_records_snapshot_id", "metric_records", ["snapshot_id"])
    op.create_index("ix_metric_records_run_id", "metric_records", ["run_id"])

    op.create_table(
        "assertion_reviews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("assertion_id", sa.String(64), nullable=False),
        sa.Column("rubric_label", sa.String(16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "reviewer_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "assertion_id"),
    )
    op.create_index("ix_assertion_reviews_project_id", "assertion_reviews", ["project_id"])
    op.create_index("ix_assertion_reviews_run_id", "assertion_reviews", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_assertion_reviews_run_id", table_name="assertion_reviews")
    op.drop_index("ix_assertion_reviews_project_id", table_name="assertion_reviews")
    op.drop_table("assertion_reviews")
    op.drop_index("ix_metric_records_run_id", table_name="metric_records")
    op.drop_index("ix_metric_records_snapshot_id", table_name="metric_records")
    op.drop_index("ix_metric_records_project_id", table_name="metric_records")
    op.drop_table("metric_records")
