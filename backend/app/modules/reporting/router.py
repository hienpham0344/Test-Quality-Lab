from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.reporting.schemas import ReportResultsOutput, ReportSummaryOutput
from app.modules.reporting.service import ReportingService

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
