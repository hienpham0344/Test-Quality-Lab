"""Audit events: nullable resource_id for project create/edit (issue #86, SRS 4.8)."""

import sqlalchemy as sa
from alembic import op

revision = "20261127_0012"
down_revision = "20261126_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_events", sa.Column("resource_id", sa.Uuid(), nullable=True))
    op.create_index("ix_audit_events_resource_id", "audit_events", ["resource_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_resource_id", table_name="audit_events")
    op.drop_column("audit_events", "resource_id")
