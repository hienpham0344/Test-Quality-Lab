from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.reporting.history import (
    HISTORY_LIMIT_MAX,
    HistoryFilters,
    HistoryItemOutput,
    ProgressOutput,
    ReportHistoryService,
)
from app.modules.reporting.schemas import ReportResultsOutput, ReportSummaryOutput
from app.modules.reporting.service import ReportingService
from app.modules.reporting.strategy_summary import StrategySummaryOutput, StrategySummaryService

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])


@router.get("/summary", response_model=ReportSummaryOutput)
def get_project_report_summary(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ReportSummaryOutput:
    return ReportingService(db, artifact_dir=settings.artifact_dir).get_summary(
        user.id, project_id
    )


@router.get("/results", response_model=ReportResultsOutput)
def get_project_report_results(
    project_id: uuid.UUID,
    status: str | None = Query(default=None),
    strategy: str | None = Query(default=None),
    model: str | None = Query(default=None),
    quality: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str = Query(default="date"),
    sort_dir: str = Query(default="desc"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ReportResultsOutput:
    return ReportingService(db, artifact_dir=settings.artifact_dir).get_results(
        user.id,
        project_id,
        status=status,
        strategy=strategy,
        model=model,
        quality=quality,
        search=search,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/exports/runs.csv")
def export_project_runs_csv(
    project_id: uuid.UUID,
    status: str | None = Query(default=None),
    strategy: str | None = Query(default=None),
    model: str | None = Query(default=None),
    search: str | None = Query(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    csv_body = ReportingService(db, artifact_dir=settings.artifact_dir).export_runs_csv(
        user.id,
        project_id,
        status=status,
        strategy=strategy,
        model=model,
        search=search,
    )
    return Response(
        content=csv_body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="project-{project_id}-runs.csv"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/exports/strategy-comparison.csv")
def export_project_strategy_comparison_csv(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    csv_body = ReportingService(
        db, artifact_dir=settings.artifact_dir
    ).export_strategy_comparison_csv(user.id, project_id)
    return Response(
        content=csv_body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="project-{project_id}-strategy-comparison.csv"'
            ),
            "Cache-Control": "no-store",
        },
    )


@router.delete("/runs/{run_id}", response_model=ReportSummaryOutput)
def delete_project_run_result(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ReportSummaryOutput:
    return ReportingService(db, artifact_dir=settings.artifact_dir).delete_run_result(
        user.id, project_id, run_id
    )


@router.get("/progress", response_model=ProgressOutput)
def get_project_progress(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ProgressOutput:
    """FR-RPT-001 (#60): run counts per status and the position of every run."""
    return ReportHistoryService(db).progress(user.id, project_id, snapshot_id)


@router.get("/history", response_model=list[HistoryItemOutput])
def get_project_run_history(
    project_id: uuid.UUID,
    response: Response,
    experiment_id: uuid.UUID | None = Query(default=None),
    snapshot_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None, max_length=16),
    strategy: str | None = Query(default=None, max_length=8),
    provider: str | None = Query(default=None, max_length=32),
    model: str | None = Query(default=None, max_length=120),
    function_name: str | None = Query(default=None, max_length=128),
    created_from: str | None = Query(default=None, alias="from", max_length=40),
    created_to: str | None = Query(default=None, alias="to", max_length=40),
    limit: int = Query(default=50, ge=1, le=HISTORY_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[HistoryItemOutput]:
    """FR-RPT-003 (#60): owner-scoped filtered run history; matching total in `X-Total-Count`."""
    items, total = ReportHistoryService(db).history(user.id, project_id, HistoryFilters(
        experiment_id=experiment_id, snapshot_id=snapshot_id, status=status, strategy=strategy,
        provider=provider, model=model, function_name=function_name, created_from=created_from,
        created_to=created_to, limit=limit, offset=offset,
    ))
    response.headers["X-Total-Count"] = str(total)
    return items


@router.get("/strategy-summary", response_model=StrategySummaryOutput)
def get_strategy_summary(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> StrategySummaryOutput:
    """FR-EVL-006 / FR-RPT-004 (#61): comparable L1-L5 summary with sample counts and exclusions."""
    return StrategySummaryService(db).summary(user.id, project_id, snapshot_id)
