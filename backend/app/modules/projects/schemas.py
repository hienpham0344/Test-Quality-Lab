"""Request and response DTOs for the projects API (UC-03)."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class ProjectSort(StrEnum):
    CREATED_AT = "created_at"
    UPDATED_AT = "updated_at"
    NAME = "name"


class SortOrder(StrEnum):
    ASC = "asc"
    DESC = "desc"


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None


class ProjectOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    current_revision: int
    created_at: datetime
    updated_at: datetime


class ProjectListItem(ProjectOutput):
    experiment_count: int


class HistoryOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    revision: int
    name: str
    description: str | None
    changed_at: datetime
