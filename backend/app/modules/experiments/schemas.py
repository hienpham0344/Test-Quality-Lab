from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.infrastructure.llm import GenerationParameters, ProviderId
from app.modules.prompts.models import StrategyCode


class ModelTargetInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: ProviderId
    model: str = Field(min_length=1, max_length=120)


class ExperimentConfigInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: uuid.UUID
    source_revision: int = Field(gt=0)
    function_names: list[str] = Field(min_length=1, max_length=200)
    dataset_id: uuid.UUID | None = None
    dataset_revision: int | None = Field(default=None, gt=0)
    selected_rows: list[int] | None = None
    models: list[ModelTargetInput] = Field(min_length=1, max_length=50)
    strategies: list[StrategyCode] = Field(min_length=1, max_length=5)
    repeats: int = Field(default=1, ge=1, le=1000)
    parameters: GenerationParameters = Field(default_factory=GenerationParameters)


class ExperimentCreateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    config: ExperimentConfigInput


class ExperimentPatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    config: ExperimentConfigInput | None = None


class ExperimentValidationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    normalized_config: ExperimentConfigInput
    run_count: int
    can_freeze: bool
    missing_credentials: list[ProviderId]
    unapproved_strategies: list[StrategyCode]


class ExperimentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str | None
    config: ExperimentConfigInput
    run_count: int
    latest_snapshot_number: int
    created_at: datetime
    updated_at: datetime


class SnapshotRunOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    ordinal: int
    function_name: str
    function_line: int
    provider: ProviderId
    model: str
    strategy: StrategyCode
    prompt_version: int
    prompt_sha256: str
    rendered_prompt_sha256: str
    repeat_index: int
    run_hash: str


class SnapshotSummaryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    experiment_id: uuid.UUID
    project_id: uuid.UUID
    snapshot_number: int
    source_id: uuid.UUID
    source_revision: int
    source_sha256: str
    dataset_id: uuid.UUID | None
    dataset_revision: int | None
    dataset_sha256: str | None
    repeats: int
    run_count: int
    snapshot_sha256: str
    created_at: datetime


class SnapshotDetailOutput(SnapshotSummaryOutput):
    frozen_code: str
    frozen_functions: list[dict[str, Any]]
    frozen_rows: list[dict[str, Any]] | None
    frozen_selected_rows: list[int] | None
    frozen_models: list[dict[str, Any]]
    frozen_parameters: GenerationParameters
    frozen_prompts: dict[str, dict[str, Any]]
    runs: list[SnapshotRunOutput]
