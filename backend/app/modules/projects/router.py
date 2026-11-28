"""Projects API (UC-03: FR-PRJ-001/002/003). Errors use the SRS §3.15 body via AppError."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.projects.models import Project, ProjectHistory
from app.modules.projects.schemas import (
    HistoryOutput,
    ProjectInput,
    ProjectListItem,
    ProjectOutput,
    ProjectSort,
    ProjectUpdate,
    SortOrder,
)
from app.modules.projects.service import ProjectService, ProjectSummary
from app.modules.projects.validation import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SEARCH_MAX_LENGTH

router = APIRouter(prefix="/projects", tags=["projects"])

TOTAL_COUNT_HEADER = "X-Total-Count"


@router.post("", status_code=201, response_model=ProjectOutput)
def create(
    payload: ProjectInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Project:
    return ProjectService(db).create(user.id, payload.name, payload.description)


@router.get("", response_model=list[ProjectListItem])
def list_projects(
    response: Response,
    q: str | None = Query(default=None, max_length=SEARCH_MAX_LENGTH),
    sort: ProjectSort = Query(default=ProjectSort.CREATED_AT),
    order: SortOrder = Query(default=SortOrder.DESC),
    limit: int = Query(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[ProjectSummary]:
    page = ProjectService(db).list_owned(
        user.id, q=q, sort=sort, order=order, limit=limit, offset=offset
    )
    response.headers[TOTAL_COUNT_HEADER] = str(page.total)
    return page.items


@router.get("/{project_id}", response_model=ProjectOutput)
def get_project(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Project:
    return ProjectService(db).get_owned(user.id, project_id)


@router.patch("/{project_id}", response_model=ProjectOutput)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Project:
    return ProjectService(db).patch(user.id, project_id, payload.model_dump(exclude_unset=True))


@router.get("/{project_id}/history", response_model=list[HistoryOutput])
def project_history(
    project_id: uuid.UUID,
    changed_from: str | None = Query(default=None, alias="from"),
    changed_to: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[ProjectHistory]:
    return ProjectService(db).history(
        user.id,
        project_id,
        changed_from=changed_from,
        changed_to=changed_to,
        limit=limit,
        offset=offset,
    )
