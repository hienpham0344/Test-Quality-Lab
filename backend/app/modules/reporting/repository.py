"""Unified reporting repository reading report_runs and optional S4/S6 generation & metric tables."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.reporting.models import ReportRunRecord


@dataclass
class UnifiedRunView:
    id: uuid.UUID
    project_id: uuid.UUID
    snapshot_id: uuid.UUID | None
    snapshot_sha256: str | None
    source_id: uuid.UUID | None
    source_name: str | None
    source_sha256: str
    dataset_id: uuid.UUID | None
    dataset_name: str | None
    dataset_sha256: str | None
    suite_name: str
    function_name: str | None
    provider: str
    model: str
    strategy: str
    prompt_version: int | None
    prompt_sha256: str | None
    repeat_index: int
    status: str
    duration_ms: int | None
    total_cases: int
    completed_cases: int
    passed_cases: int
    failed_cases: int
    timeout_cases: int
    syntax_validity_state: str
    syntax_validity_value: float | None
    line_coverage_state: str
    line_coverage_value: float | None
    mutation_score_state: str
    mutation_score_value: float | None
    assertion_quality_state: str
    assertion_quality_value: float | None
    artifact_relpath: str | None
    artifact_sha256: str | None
    error_message: str | None
    created_at: datetime


_UUID_COLS = frozenset(
    {"id", "job_id", "project_id", "snapshot_id", "snapshot_run_id", "run_id", "reviewer_id"}
)
_INT_COLS = frozenset(
    {"ordinal", "repeat_index", "attempt_count", "prompt_tokens", "completion_tokens", "latency_ms"}
)
_FLOAT_COLS = frozenset({"numeric_value"})
_JSON_COLS = frozenset({"error_info", "details"})
_DT_COLS = frozenset({"started_at", "finished_at", "created_at", "updated_at", "evaluated_at"})


def load_optional_table(db: Session, table_name: str) -> sa.Table | None:
    inspector = sa_inspect(db.connection())
    if not inspector.has_table(table_name):
        return None
    col_defs = inspector.get_columns(table_name)
    meta = sa.MetaData()
    cols: list[sa.Column[Any]] = []
    for info in col_defs:
        cname = info["name"]
        col_type: sa.types.TypeEngine[Any]
        if cname in _UUID_COLS:
            col_type = sa.Uuid(as_uuid=True)
        elif cname in _INT_COLS:
            col_type = sa.Integer()
        elif cname in _FLOAT_COLS:
            col_type = sa.Float()
        elif cname in _JSON_COLS:
            col_type = sa.JSON()
        elif cname in _DT_COLS:
            col_type = sa.DateTime()
        else:
            col_type = sa.String()
        cols.append(sa.Column(cname, col_type))
    return sa.Table(table_name, meta, *cols)


def _coerce_dt(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, str):
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    return datetime.min


class ReportingRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add_run(self, record: ReportRunRecord) -> None:
        self.db.add(record)

    def get_report_run(self, project_id: uuid.UUID, run_id: uuid.UUID) -> ReportRunRecord | None:
        return self.db.scalar(
            select(ReportRunRecord).where(
                ReportRunRecord.project_id == project_id,
                ReportRunRecord.id == run_id,
            )
        )

    def list_report_runs(self, project_id: uuid.UUID) -> list[ReportRunRecord]:
        stmt = (
            select(ReportRunRecord)
            .where(ReportRunRecord.project_id == project_id)
            .order_by(ReportRunRecord.created_at.desc(), ReportRunRecord.id.desc())
        )
        return list(self.db.scalars(stmt))

    @staticmethod
    def _from_report_record(row: ReportRunRecord) -> UnifiedRunView:
        return UnifiedRunView(
            id=row.id,
            project_id=row.project_id,
            snapshot_id=row.snapshot_id,
            snapshot_sha256=row.snapshot_sha256,
            source_id=row.source_id,
            source_name=row.source_name,
            source_sha256=row.source_sha256,
            dataset_id=row.dataset_id,
            dataset_name=row.dataset_name,
            dataset_sha256=row.dataset_sha256,
            suite_name=row.suite_name,
            function_name=row.function_name,
            provider=row.provider,
            model=row.model,
            strategy=row.strategy,
            prompt_version=row.prompt_version,
            prompt_sha256=row.prompt_sha256,
            repeat_index=row.repeat_index,
            status=row.status,
            duration_ms=row.duration_ms,
            total_cases=row.total_cases,
            completed_cases=row.completed_cases,
            passed_cases=row.passed_cases,
            failed_cases=row.failed_cases,
            timeout_cases=row.timeout_cases,
            syntax_validity_state=row.syntax_validity_state,
            syntax_validity_value=row.syntax_validity_value,
            line_coverage_state=row.line_coverage_state,
            line_coverage_value=row.line_coverage_value,
            mutation_score_state=row.mutation_score_state,
            mutation_score_value=row.mutation_score_value,
            assertion_quality_state=row.assertion_quality_state,
            assertion_quality_value=row.assertion_quality_value,
            artifact_relpath=row.artifact_relpath,
            artifact_sha256=row.artifact_sha256,
            error_message=row.error_message,
            created_at=row.created_at,
        )

    def _load_generation_views(self, project_id: uuid.UUID) -> list[UnifiedRunView]:
        gen_tbl = load_optional_table(self.db, "generation_runs")
        if gen_tbl is None:
            return []

        gen_rows = list(
            self.db.execute(select(gen_tbl).where(gen_tbl.c.project_id == project_id)).mappings()
        )
        if not gen_rows:
            return []

        snap_ids = {r["snapshot_id"] for r in gen_rows if r.get("snapshot_id") is not None}
        snapshots: dict[uuid.UUID, ExperimentSnapshot] = {}
        experiments: dict[uuid.UUID, Experiment] = {}
        snap_runs: dict[uuid.UUID, ExperimentSnapshotRun] = {}

        if snap_ids:
            for snap in self.db.scalars(
                select(ExperimentSnapshot).where(ExperimentSnapshot.id.in_(snap_ids))
            ):
                snapshots[snap.id] = snap
            exp_ids = {s.experiment_id for s in snapshots.values()}
            if exp_ids:
                for exp in self.db.scalars(select(Experiment).where(Experiment.id.in_(exp_ids))):
                    experiments[exp.id] = exp
            for sr in self.db.scalars(
                select(ExperimentSnapshotRun).where(ExperimentSnapshotRun.snapshot_id.in_(snap_ids))
            ):
                snap_runs[sr.id] = sr

        metrics_by_run: dict[uuid.UUID, dict[str, tuple[str, float | None]]] = {}
        metric_tbl = load_optional_table(self.db, "metric_records")
        if metric_tbl is not None:
            for mrow in self.db.execute(
                select(metric_tbl).where(metric_tbl.c.project_id == project_id)
            ).mappings():
                rid = mrow["run_id"]
                mname = str(mrow["metric_name"])
                mstate = str(mrow["state"])
                mval = float(mrow["numeric_value"]) if mrow["numeric_value"] is not None else None
                metrics_by_run.setdefault(rid, {})[mname] = (mstate, mval)

        views: list[UnifiedRunView] = []
        for row in gen_rows:
            run_id: uuid.UUID = row["id"]
            raw_snap_id = row.get("snapshot_id")
            matched_snap: ExperimentSnapshot | None = (
                snapshots.get(raw_snap_id) if isinstance(raw_snap_id, uuid.UUID) else None
            )
            matched_exp: Experiment | None = (
                experiments.get(matched_snap.experiment_id) if matched_snap is not None else None
            )
            raw_srun_id = row.get("snapshot_run_id")
            matched_srun: ExperimentSnapshotRun | None = (
                snap_runs.get(raw_srun_id) if isinstance(raw_srun_id, uuid.UUID) else None
            )
            status = str(row["status"]).upper()
            rmetrics = metrics_by_run.get(run_id, {})

            default_non_measured = (
                "TIMEOUT"
                if status == "TIMEOUT"
                else "FAILED"
                if status == "FAILED"
                else "N/A"
            )
            syn_state, syn_val = rmetrics.get("syntax_validity", (default_non_measured, None))
            cov_state, cov_val = rmetrics.get("line_coverage", (default_non_measured, None))
            mut_state, mut_val = rmetrics.get("mutation_score", (default_non_measured, None))
            ast_state, ast_val = rmetrics.get("assertion_quality", (default_non_measured, None))

            total_cases = 1
            completed_cases = 1 if status in ("COMPLETED", "FAILED", "TIMEOUT") else 0
            if status == "COMPLETED":
                if syn_state == "MEASURED" and syn_val == 0.0:
                    passed_cases = 0
                    failed_cases = 1
                else:
                    passed_cases = 1
                    failed_cases = 0
                timeout_cases = 0
            elif status == "FAILED":
                passed_cases = 0
                failed_cases = 1
                timeout_cases = 0
            elif status == "TIMEOUT":
                passed_cases = 0
                failed_cases = 0
                timeout_cases = 1
            else:
                passed_cases = 0
                failed_cases = 0
                timeout_cases = 0

            err_info = row.get("error_info")
            err_msg = (
                str(err_info.get("message"))
                if isinstance(err_info, dict) and err_info.get("message")
                else None
            )
            suite_name = (
                f"{matched_exp.name} #{matched_snap.snapshot_number}"
                if matched_exp is not None and matched_snap is not None
                else f"Run {row.get('function_name') or run_id}"
            )
            views.append(
                UnifiedRunView(
                    id=run_id,
                    project_id=project_id,
                    snapshot_id=matched_snap.id if matched_snap is not None else raw_snap_id,
                    snapshot_sha256=(
                        matched_snap.snapshot_sha256 if matched_snap is not None else None
                    ),
                    source_id=matched_snap.source_id if matched_snap is not None else None,
                    source_name=(
                        f"source_rev_{matched_snap.source_revision}.py"
                        if matched_snap is not None
                        else None
                    ),
                    source_sha256=(
                        matched_snap.source_sha256 if matched_snap is not None else ("0" * 64)
                    ),
                    dataset_id=matched_snap.dataset_id if matched_snap is not None else None,
                    dataset_name=(
                        f"dataset_rev_{matched_snap.dataset_revision}.csv"
                        if matched_snap is not None and matched_snap.dataset_id is not None
                        else None
                    ),
                    dataset_sha256=(
                        matched_snap.dataset_sha256 if matched_snap is not None else None
                    ),
                    suite_name=suite_name,
                    function_name=row.get("function_name"),
                    provider=str(row.get("provider") or "unknown"),
                    model=str(row.get("model") or "unknown"),
                    strategy=str(row.get("strategy") or "L1"),
                    prompt_version=(
                        matched_srun.prompt_version if matched_srun is not None else None
                    ),
                    prompt_sha256=(
                        matched_srun.prompt_sha256 if matched_srun is not None else None
                    ),
                    repeat_index=int(row.get("repeat_index") or 1),
                    status=status,
                    duration_ms=(
                        int(row["latency_ms"]) if row.get("latency_ms") is not None else None
                    ),
                    total_cases=total_cases,
                    completed_cases=completed_cases,
                    passed_cases=passed_cases,
                    failed_cases=failed_cases,
                    timeout_cases=timeout_cases,
                    syntax_validity_state=syn_state,
                    syntax_validity_value=syn_val,
                    line_coverage_state=cov_state,
                    line_coverage_value=cov_val,
                    mutation_score_state=mut_state,
                    mutation_score_value=mut_val,
                    assertion_quality_state=ast_state,
                    assertion_quality_value=ast_val,
                    artifact_relpath=row.get("artifact_relpath"),
                    artifact_sha256=row.get("artifact_sha256"),
                    error_message=err_msg,
                    created_at=_coerce_dt(row.get("created_at")),
                )
            )
        return views

    def list_unified_runs(self, project_id: uuid.UUID) -> list[UnifiedRunView]:
        by_id: dict[uuid.UUID, UnifiedRunView] = {}
        for gen_view in self._load_generation_views(project_id):
            by_id[gen_view.id] = gen_view
        for rep_row in self.list_report_runs(project_id):
            by_id[rep_row.id] = self._from_report_record(rep_row)
        return sorted(by_id.values(), key=lambda r: (r.created_at, str(r.id)), reverse=True)

    def find_run_artifacts_and_exists(
        self, project_id: uuid.UUID, run_id: uuid.UUID
    ) -> tuple[bool, list[str]]:
        relpaths: list[str] = []
        found = False

        rep = self.get_report_run(project_id, run_id)
        if rep is not None:
            found = True
            if rep.artifact_relpath:
                relpaths.append(rep.artifact_relpath)

        gen_tbl = load_optional_table(self.db, "generation_runs")
        if gen_tbl is not None:
            grow = self.db.execute(
                select(gen_tbl).where(
                    gen_tbl.c.project_id == project_id,
                    gen_tbl.c.id == run_id,
                )
            ).mappings().first()
            if grow is not None:
                found = True
                rel = grow.get("artifact_relpath")
                if rel and rel not in relpaths:
                    relpaths.append(str(rel))

        return found, relpaths

    def delete_run_records(self, project_id: uuid.UUID, run_id: uuid.UUID) -> None:
        review_tbl = load_optional_table(self.db, "assertion_reviews")
        if review_tbl is not None:
            self.db.execute(
                sa.delete(review_tbl).where(
                    review_tbl.c.project_id == project_id,
                    review_tbl.c.run_id == run_id,
                )
            )

        metric_tbl = load_optional_table(self.db, "metric_records")
        if metric_tbl is not None:
            self.db.execute(
                sa.delete(metric_tbl).where(
                    metric_tbl.c.project_id == project_id,
                    metric_tbl.c.run_id == run_id,
                )
            )

        gen_tbl = load_optional_table(self.db, "generation_runs")
        if gen_tbl is not None:
            self.db.execute(
                sa.delete(gen_tbl).where(
                    gen_tbl.c.project_id == project_id,
                    gen_tbl.c.id == run_id,
                )
            )

        rep = self.get_report_run(project_id, run_id)
        if rep is not None:
            self.db.delete(rep)
