"""Immutable Python source versions owned through projects."""

import sqlalchemy as sa
from alembic import op

revision = "20261107_0003"
down_revision = "20261101_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("current_revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_sources_project_id", "sources", ["project_id"])
    op.create_table(
        "source_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "source_id", sa.Uuid(), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("source_id", "revision"),
    )
    op.create_index("ix_source_versions_source_id", "source_versions", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_source_versions_source_id", table_name="source_versions")
    op.drop_table("source_versions")
    op.drop_index("ix_sources_project_id", table_name="sources")
    op.drop_table("sources")
