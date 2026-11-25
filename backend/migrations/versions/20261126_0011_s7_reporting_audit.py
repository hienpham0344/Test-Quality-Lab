"""Sprint 7 reporting run records table."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_0011"
down_revision = "20261126_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_runs",
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
            nullable=True,
        ),
        sa.Column("snapshot_sha256", sa.String(64), nullable=True),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("source_name", sa.String(255), nullable=True),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("dataset_id", sa.Uuid(), nullable=True),
        sa.Column("dataset_name", sa.String(255), nullable=True),
        sa.Column("dataset_sha256", sa.String(64), nullable=True),
        sa.Column("suite_name", sa.String(200), nullable=False),
        sa.Column("function_name", sa.String(128), nullable=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("strategy", sa.String(16), nullable=False),
        sa.Column("prompt_version", sa.Integer(), nullable=True),
        sa.Column("prompt_sha256", sa.String(64), nullable=True),
        sa.Column("repeat_index", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("total_cases", sa.Integer(), nullable=False),
        sa.Column("completed_cases", sa.Integer(), nullable=False),
        sa.Column("passed_cases", sa.Integer(), nullable=False),
        sa.Column("failed_cases", sa.Integer(), nullable=False),
        sa.Column("timeout_cases", sa.Integer(), nullable=False),
        sa.Column("syntax_validity_state", sa.String(16), nullable=False),
        sa.Column("syntax_validity_value", sa.Float(), nullable=True),
        sa.Column("line_coverage_state", sa.String(16), nullable=False),
        sa.Column("line_coverage_value", sa.Float(), nullable=True),
        sa.Column("mutation_score_state", sa.String(16), nullable=False),
        sa.Column("mutation_score_value", sa.Float(), nullable=True),
        sa.Column("assertion_quality_state", sa.String(16), nullable=False),
        sa.Column("assertion_quality_value", sa.Float(), nullable=True),
        sa.Column("artifact_relpath", sa.String(512), nullable=True),
        sa.Column("artifact_sha256", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_report_runs_project_id", "report_runs", ["project_id"])
    op.create_index("ix_report_runs_snapshot_id", "report_runs", ["snapshot_id"])


def downgrade() -> None:
    op.drop_index("ix_report_runs_snapshot_id", table_name="report_runs")
    op.drop_index("ix_report_runs_project_id", table_name="report_runs")
    op.drop_table("report_runs")
