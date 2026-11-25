"""Experiments, immutable experiment snapshots, and planned run matrix."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_0008"
down_revision = "20261125_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "experiments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("draft_config", sa.JSON(), nullable=False),
        sa.Column("latest_snapshot_number", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_experiments_project_id", "experiments", ["project_id"])

    op.create_table(
        "experiment_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "experiment_id",
            sa.Uuid(),
            sa.ForeignKey("experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snapshot_number", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("frozen_code", sa.Text(), nullable=False),
        sa.Column("frozen_functions", sa.JSON(), nullable=False),
        sa.Column("dataset_id", sa.Uuid(), nullable=True),
        sa.Column("dataset_revision", sa.Integer(), nullable=True),
        sa.Column("dataset_sha256", sa.String(64), nullable=True),
        sa.Column("frozen_rows", sa.JSON(), nullable=True),
        sa.Column("frozen_selected_rows", sa.JSON(), nullable=True),
        sa.Column("frozen_models", sa.JSON(), nullable=False),
        sa.Column("frozen_parameters", sa.JSON(), nullable=False),
        sa.Column("frozen_prompts", sa.JSON(), nullable=False),
        sa.Column("repeats", sa.Integer(), nullable=False),
        sa.Column("run_count", sa.Integer(), nullable=False),
        sa.Column("snapshot_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("experiment_id", "snapshot_number"),
    )
    op.create_index(
        "ix_experiment_snapshots_experiment_id", "experiment_snapshots", ["experiment_id"]
    )
    op.create_index(
        "ix_experiment_snapshots_project_id", "experiment_snapshots", ["project_id"]
    )

    op.create_table(
        "experiment_snapshot_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "snapshot_id",
            sa.Uuid(),
            sa.ForeignKey("experiment_snapshots.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("function_name", sa.String(128), nullable=False),
        sa.Column("function_line", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("strategy", sa.String(8), nullable=False),
        sa.Column("prompt_version", sa.Integer(), nullable=False),
        sa.Column("prompt_sha256", sa.String(64), nullable=False),
        sa.Column("rendered_prompt_sha256", sa.String(64), nullable=False),
        sa.Column("repeat_index", sa.Integer(), nullable=False),
        sa.Column("run_hash", sa.String(64), nullable=False),
        sa.UniqueConstraint("snapshot_id", "ordinal"),
    )
    op.create_index(
        "ix_experiment_snapshot_runs_snapshot_id",
        "experiment_snapshot_runs",
        ["snapshot_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_experiment_snapshot_runs_snapshot_id", table_name="experiment_snapshot_runs"
    )
    op.drop_table("experiment_snapshot_runs")
    op.drop_index("ix_experiment_snapshots_project_id", table_name="experiment_snapshots")
    op.drop_index(
        "ix_experiment_snapshots_experiment_id", table_name="experiment_snapshots"
    )
    op.drop_table("experiment_snapshots")
    op.drop_index("ix_experiments_project_id", table_name="experiments")
    op.drop_table("experiments")
