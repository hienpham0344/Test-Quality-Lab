import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.base import Base


class ProviderCredential(Base):
    """Owner-scoped encrypted LLM provider configuration (never stores plaintext keys)."""

    __tablename__ = "provider_credentials"
    __table_args__ = (UniqueConstraint("project_id", "provider"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    default_model: Mapped[str] = mapped_column(String(120), nullable=False)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_secret: Mapped[str] = mapped_column(Text, nullable=False)
    key_hint: Mapped[str] = mapped_column(String(32), nullable=False)
    default_params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
