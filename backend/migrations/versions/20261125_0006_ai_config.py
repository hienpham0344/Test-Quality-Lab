"""Encrypted project-scoped AI provider credentials."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_0006"
down_revision = "20261109_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_credentials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("default_model", sa.String(120), nullable=False),
        sa.Column("key_id", sa.String(64), nullable=False),
        sa.Column("encrypted_secret", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.String(32), nullable=False),
        sa.Column("default_params", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "provider"),
    )
    op.create_index(
        "ix_provider_credentials_project_id", "provider_credentials", ["project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_provider_credentials_project_id", table_name="provider_credentials")
    op.drop_table("provider_credentials")
