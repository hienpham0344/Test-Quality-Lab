"""Sandbox execution records (#45-#49, FR-EXE-001..004, FR-EVL-002)."""

import sqlalchemy as sa
from alembic import op

revision = "20261127_0014"
down_revision = "20261127_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "generation_run_id", sa.Uuid(), sa.ForeignKey("generation_runs.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("suite_name", sa.String(200), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("source_revision", sa.Integer(), nullable=True),
        sa.Column("source_sha256", sa.String(64), nullable=True),
        sa.Column("dataset_id", sa.Uuid(), nullable=True),
        sa.Column("dataset_revision", sa.Integer(), nullable=True),
        sa.Column("dataset_sha256", sa.String(64), nullable=True),
        sa.Column("artifact_sha256", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("celery_task_id", sa.String(128), nullable=True),
        sa.Column("container_name", sa.String(64), nullable=True),
        sa.Column("total_cases", sa.Integer(), nullable=False),
        sa.Column("passed_cases", sa.Integer(), nullable=False),
        sa.Column("failed_cases", sa.Integer(), nullable=False),
        sa.Column("error_cases", sa.Integer(), nullable=False),
        sa.Column("skipped_cases", sa.Integer(), nullable=False),
        sa.Column("timeout_cases", sa.Integer(), nullable=False),
        sa.Column("cases", sa.JSON(), nullable=False),
        sa.Column("logs", sa.JSON(), nullable=False),
        sa.Column("oracle", sa.JSON(), nullable=True),
        sa.Column("sandbox_policy", sa.JSON(), nullable=False),
        sa.Column("error_info", sa.JSON(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_executions_project_id", "executions", ["project_id"])
    op.create_index("ix_executions_generation_run_id", "executions", ["generation_run_id"])
    op.create_index("ix_executions_status", "executions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_executions_status", table_name="executions")
    op.drop_index("ix_executions_generation_run_id", table_name="executions")
    op.drop_index("ix_executions_project_id", table_name="executions")
    op.drop_table("executions")
