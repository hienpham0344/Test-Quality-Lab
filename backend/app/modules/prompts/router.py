from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.prompts.schemas import (
    PromptRenderInput,
    PromptRenderOutput,
    PromptTemplateSummary,
    PromptVersionInput,
    PromptVersionOutput,
)
from app.modules.prompts.service import PromptRegistryService

router = APIRouter(prefix="/projects/{project_id}/prompts", tags=["prompts"])


@router.get("", response_model=list[PromptTemplateSummary])
def list_prompt_strategies(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[PromptTemplateSummary]:
    return PromptRegistryService(db).list_strategies(user.id, project_id)


@router.get("/{strategy}/versions", response_model=list[PromptVersionOutput])
def list_prompt_versions(
    project_id: uuid.UUID,
    strategy: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[PromptVersionOutput]:
    return PromptRegistryService(db).list_versions(user.id, project_id, strategy)


@router.post("/{strategy}/versions", status_code=201, response_model=PromptVersionOutput)
def create_prompt_version(
    project_id: uuid.UUID,
    strategy: str,
    payload: PromptVersionInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PromptVersionOutput:
    return PromptRegistryService(db).create_version(user.id, project_id, strategy, payload)


@router.post("/{strategy}/versions/{version}/approve", response_model=PromptVersionOutput)
def approve_prompt_version(
    project_id: uuid.UUID,
    strategy: str,
    version: int = Path(gt=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PromptVersionOutput:
    return PromptRegistryService(db).approve_version(user.id, project_id, strategy, version)


@router.post("/{strategy}/render", response_model=PromptRenderOutput)
def render_approved_prompt(
    project_id: uuid.UUID,
    strategy: str,
    payload: PromptRenderInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PromptRenderOutput:
    return PromptRegistryService(db).render_approved(user.id, project_id, strategy, payload.context)
