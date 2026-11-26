from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.infrastructure.database.session import get_db
from app.modules.audit.backup import BackupRestoreOutput, BackupService
from app.modules.audit.integrity import (
    IntegrityReportOutput,
    IntegrityService,
    OrphanCleanupOutput,
)
from app.modules.audit.service import AuditService
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User

router = APIRouter(tags=["audit"])


class AuditEventOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None
    action: str
    resource_id: uuid.UUID | None = None
    created_at: datetime


@router.get("/audit-events", response_model=list[AuditEventOutput])
def list_audit_events(
    action: str | None = Query(default=None),
    from_raw: str | None = Query(default=None, alias="from"),
    to_raw: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[AuditEventOutput]:
    events = AuditService(db).list_user_events(
        user.id,
        action=action,
        from_raw=from_raw,
        to_raw=to_raw,
        limit=limit,
        offset=offset,
    )
    return [AuditEventOutput.model_validate(ev) for ev in events]


@router.get(
    "/projects/{project_id}/audit/integrity",
    response_model=IntegrityReportOutput,
)
def check_project_integrity(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> IntegrityReportOutput:
    return IntegrityService(db).verify_project_integrity(
        user.id, project_id, settings.artifact_dir
    )


@router.post(
    "/projects/{project_id}/audit/cleanup-orphans",
    response_model=OrphanCleanupOutput,
)
def cleanup_project_orphan_artifacts(
    project_id: uuid.UUID,
    dry_run: bool = Query(default=False),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> OrphanCleanupOutput:
    return IntegrityService(db).cleanup_orphan_artifacts(
        user.id, project_id, settings.artifact_dir, dry_run=dry_run
    )


@router.post("/projects/{project_id}/audit/backup-export")
def export_project_backup_endpoint(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return BackupService(db).export_project_backup(
        user.id, project_id, settings.artifact_dir
    )


@router.post(
    "/audit/backup-restore",
    status_code=201,
    response_model=BackupRestoreOutput,
)
def restore_project_backup_endpoint(
    payload: dict[str, Any] = Body(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> BackupRestoreOutput:
    bundle = (
        payload["bundle"]
        if "bundle" in payload and isinstance(payload["bundle"], dict) and "schema_version" not in payload
        else payload
    )
    return BackupService(db).restore_project_backup(user.id, bundle)
