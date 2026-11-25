from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.infrastructure.llm import GenerationParameters, ProviderId


class ProviderCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: ProviderId
    label: str
    auth_scheme: str


class ProviderCredentialInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: SecretStr = Field(min_length=8, max_length=512)
    default_model: str = Field(min_length=1, max_length=120)
    default_params: GenerationParameters = Field(default_factory=GenerationParameters)


class ProviderCredentialOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    project_id: uuid.UUID
    provider: ProviderId
    default_model: str
    key_id: str
    key_hint: str
    needs_rotation: bool
    default_params: GenerationParameters
    created_at: datetime
    updated_at: datetime
