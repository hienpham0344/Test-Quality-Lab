from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.prompts.models import PromptStatus, StrategyCode


class PromptTemplateSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    strategy: StrategyCode
    title: str
    current_version: int
    approved_version: int | None
    status: PromptStatus
    updated_at: datetime


class PromptVersionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system_template: str | None = Field(default=None, max_length=16000)
    user_template: str = Field(min_length=1, max_length=32000)
    notes: str | None = Field(default=None, max_length=2000)


class PromptVersionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    template_id: uuid.UUID
    strategy: StrategyCode
    version: int
    status: PromptStatus
    system_template: str | None
    user_template: str
    required_variables: list[str]
    sha256: str
    notes: str | None
    approved_at: datetime | None
    created_at: datetime


class PromptRenderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    context: dict[str, str]


class PromptRenderOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    strategy: StrategyCode
    version: int
    template_sha256: str
    rendered_system: str | None
    rendered_user: str
    rendered_sha256: str
