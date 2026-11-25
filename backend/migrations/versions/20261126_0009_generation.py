"""Generation jobs and run execution records."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_0009"
down_revision = "20261125_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "generation_jobs",
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
            nullable=False,
        ),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("celery_task_id", sa.String(128), nullable=True),
        sa.Column("cancel_reason", sa.String(500), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "request_id"),
    )
    op.create_index("ix_generation_jobs_project_id", "generation_jobs", ["project_id"])
    op.create_index("ix_generation_jobs_snapshot_id", "generation_jobs", ["snapshot_id"])
    op.create_index("ix_generation_jobs_status", "generation_jobs", ["status"])

    op.create_table(
        "generation_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "job_id",
            sa.Uuid(),
            sa.ForeignKey("generation_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
            nullable=False,
        ),
        sa.Column(
            "snapshot_run_id",
            sa.Uuid(),
            sa.ForeignKey("experiment_snapshot_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("function_name", sa.String(128), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("strategy", sa.String(8), nullable=False),
        sa.Column("repeat_index", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_code", sa.Text(), nullable=True),
        sa.Column("artifact_relpath", sa.String(512), nullable=True),
        sa.Column("artifact_sha256", sa.String(64), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_info", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("job_id", "ordinal"),
    )
    op.create_index("ix_generation_runs_job_id", "generation_runs", ["job_id"])
    op.create_index("ix_generation_runs_project_id", "generation_runs", ["project_id"])
    op.create_index("ix_generation_runs_snapshot_id", "generation_runs", ["snapshot_id"])
    op.create_index(
        "ix_generation_runs_snapshot_run_id", "generation_runs", ["snapshot_run_id"]
    )
    op.create_index("ix_generation_runs_status", "generation_runs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_generation_runs_status", table_name="generation_runs")
    op.drop_index("ix_generation_runs_snapshot_run_id", table_name="generation_runs")
    op.drop_index("ix_generation_runs_snapshot_id", table_name="generation_runs")
    op.drop_index("ix_generation_runs_project_id", table_name="generation_runs")
    op.drop_index("ix_generation_runs_job_id", table_name="generation_runs")
    op.drop_table("generation_runs")

    op.drop_index("ix_generation_jobs_status", table_name="generation_jobs")
    op.drop_index("ix_generation_jobs_snapshot_id", table_name="generation_jobs")
    op.drop_index("ix_generation_jobs_project_id", table_name="generation_jobs")
    op.drop_table("generation_jobs")
