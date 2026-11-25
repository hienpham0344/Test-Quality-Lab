"""Project-scoped versioned L1-L5 prompt templates and immutable prompt versions."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_0007"
down_revision = "20261125_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("strategy", sa.String(8), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.Column("approved_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "strategy"),
    )
    op.create_index("ix_prompt_templates_project_id", "prompt_templates", ["project_id"])
    op.create_index("ix_prompt_templates_strategy", "prompt_templates", ["strategy"])

    op.create_table(
        "prompt_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "template_id",
            sa.Uuid(),
            sa.ForeignKey("prompt_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("strategy", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("system_template", sa.Text(), nullable=True),
        sa.Column("user_template", sa.Text(), nullable=False),
        sa.Column("required_variables", sa.JSON(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("template_id", "version"),
    )
    op.create_index("ix_prompt_versions_template_id", "prompt_versions", ["template_id"])
    op.create_index("ix_prompt_versions_strategy", "prompt_versions", ["strategy"])


def downgrade() -> None:
    op.drop_index("ix_prompt_versions_strategy", table_name="prompt_versions")
    op.drop_index("ix_prompt_versions_template_id", table_name="prompt_versions")
    op.drop_table("prompt_versions")
    op.drop_index("ix_prompt_templates_strategy", table_name="prompt_templates")
    op.drop_index("ix_prompt_templates_project_id", table_name="prompt_templates")
    op.drop_table("prompt_templates")
