import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.projects.service import ProjectService

router = APIRouter(prefix="/projects", tags=["projects"])


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


class HistoryOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    revision: int
    name: str
    description: str | None
    changed_at: datetime


@router.post("", status_code=201, response_model=ProjectOutput)
def create(
    payload: ProjectInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        return ProjectService(db).create(user.id, payload.name, payload.description)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("", response_model=list[ProjectOutput])
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return ProjectService(db).list_owned(user.id)


@router.get("/{project_id}", response_model=ProjectOutput)
def get_project(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project = ProjectService(db).get(user.id, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectOutput)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    service = ProjectService(db)
    try:
        updated = service.patch(user.id, project_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.get("/{project_id}/history", response_model=list[HistoryOutput])
def project_history(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    history = ProjectService(db).history(user.id, project_id)
    if history is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return history
