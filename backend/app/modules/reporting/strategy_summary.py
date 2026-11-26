"""Comparable L1-L5 strategy summary (SRS FR-EVL-006, FR-RPT-004, BR-04, BR-11) — issue #61.

Groups generation runs by (provider, model, function) and strategy. A metric is pooled only from runs that
share the same measurement conditions (source, dataset, generation parameters, metric unit); a group with
mixed conditions is not aggregated and says why. Each cell reports valid sample counts, excluded runs by
reason, the sample range and pooled numerator/denominator. Nothing here ranks strategies: with fewer than two
strategies holding valid samples the group is INSUFFICIENT_EVIDENCE.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import defaultdict
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.modules.evaluation.models import MetricName, MetricRecord
from app.modules.experiments.models import ExperimentSnapshot
from app.modules.generation.models import GenerationRun
from app.modules.projects.repository import ProjectRepository

STRATEGIES = ("L1", "L2", "L3", "L4", "L5")
SUMMARY_METRICS = (
    MetricName.SYNTAX_VALIDITY, MetricName.LINE_COVERAGE, MetricName.BRANCH_COVERAGE,
    MetricName.MUTATION_SCORE, MetricName.ASSERTION_QUALITY,
)
METHODOLOGY = (
    "Per-run metric values are pooled only within one model, one target function and identical measurement "
    "conditions (source, dataset and generation parameters). mean = average of MEASURED run values; "
    "pooled = sum(numerators) / sum(denominators) x 100. N/A, FAILED, TIMEOUT and unevaluated runs are excluded "
    "and counted. Coverage describes executed code, not absolute test quality; no strategy is declared better."
)

GroupStatus = Literal["COMPARABLE", "INCOMPARABLE", "INSUFFICIENT_EVIDENCE"]


class MetricCellOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    metric: str
    unit: str
    valid_samples: int
    excluded: dict[str, int]
    mean: float | None
    min: float | None
    max: float | None
    pooled_numerator: int | None
    pooled_denominator: int | None
    pooled_value: float | None


class StrategyRowOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    strategy: str
    runs: int
    completed_runs: int
    metrics: list[MetricCellOutput]


class StrategyGroupOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str
    model: str
    function_name: str
    status: GroupStatus
    reasons: list[str]
    condition_keys: list[str]
    strategies_with_valid_samples: list[str]
    strategies: list[StrategyRowOutput]


class StrategySummaryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: uuid.UUID
    snapshot_id: uuid.UUID | None
    methodology: str
    total_runs: int
    groups: list[StrategyGroupOutput]


def condition_key(snapshot: ExperimentSnapshot) -> str:
    """Measurement conditions that must match before values may be pooled."""
    payload = {
        "source_sha256": snapshot.source_sha256,
        "dataset_sha256": snapshot.dataset_sha256,
        "parameters": snapshot.frozen_parameters,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


def _cell(metric: MetricName, records: list[MetricRecord | None], *, pool: bool) -> MetricCellOutput:
    excluded: dict[str, int] = defaultdict(int)
    values: list[float] = []
    numerators: list[int] = []
    denominators: list[int] = []
    for record in records:
        if record is None:
            excluded["NOT_EVALUATED"] += 1
        elif record.state != "MEASURED" or record.numeric_value is None:
            excluded[record.state] += 1
        else:
            values.append(float(record.numeric_value))
            if record.numerator is not None and record.denominator is not None:
                numerators.append(record.numerator)
                denominators.append(record.denominator)
    complete_ratio = pool and values and len(numerators) == len(values)
    pooled_den = sum(denominators) if complete_ratio else None
    return MetricCellOutput(
        metric=metric.value,
        unit="percent",
        valid_samples=len(values),
        excluded=dict(excluded),
        mean=round(sum(values) / len(values), 2) if pool and values else None,
        min=min(values) if pool and values else None,
        max=max(values) if pool and values else None,
        pooled_numerator=sum(numerators) if complete_ratio else None,
        pooled_denominator=pooled_den,
        pooled_value=round(sum(numerators) / pooled_den * 100.0, 2) if complete_ratio and pooled_den else None,
    )


class StrategySummaryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.projects = ProjectRepository(db)

    def summary(self, owner_id: uuid.UUID, project_id: uuid.UUID, snapshot_id: uuid.UUID | None) -> StrategySummaryOutput:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")
        query = (
            select(GenerationRun, ExperimentSnapshot)
            .join(ExperimentSnapshot, ExperimentSnapshot.id == GenerationRun.snapshot_id)
            .where(GenerationRun.project_id == project_id)
        )
        if snapshot_id is not None:
            if self.db.scalar(select(ExperimentSnapshot.id).where(
                    ExperimentSnapshot.id == snapshot_id, ExperimentSnapshot.project_id == project_id)) is None:
                raise AppError(ErrorCode.NOT_FOUND, "Snapshot not found")
            query = query.where(GenerationRun.snapshot_id == snapshot_id)
        rows = self.db.execute(query).all()
        run_ids = [run.id for run, _ in rows]
        metrics: dict[tuple[uuid.UUID, str], MetricRecord] = {}
        if run_ids:
            for record in self.db.scalars(select(MetricRecord).where(
                    MetricRecord.project_id == project_id, MetricRecord.run_id.in_(run_ids))):
                metrics[(record.run_id, record.metric_name)] = record

        grouped: dict[tuple[str, str, str], list[tuple[GenerationRun, str]]] = defaultdict(list)
        for run, snap in rows:
            grouped[(run.provider, run.model, run.function_name)].append((run, condition_key(snap)))

        groups = [self._group(key, items, metrics) for key, items in sorted(grouped.items())]
        return StrategySummaryOutput(project_id=project_id, snapshot_id=snapshot_id, methodology=METHODOLOGY,
                                     total_runs=len(rows), groups=groups)

    @staticmethod
    def _group(
        key: tuple[str, str, str],
        items: list[tuple[GenerationRun, str]],
        metrics: dict[tuple[uuid.UUID, str], MetricRecord],
    ) -> StrategyGroupOutput:
        provider, model, function_name = key
        conditions = sorted({cond for _, cond in items})
        comparable_conditions = len(conditions) == 1
        reasons: list[str] = []
        if not comparable_conditions:
            reasons.append(
                f"Runs use {len(conditions)} different measurement conditions (source, dataset or parameters); "
                "values are not pooled"
            )
        by_strategy: dict[str, list[GenerationRun]] = defaultdict(list)
        for run, _ in items:
            by_strategy[run.strategy].append(run)

        rows: list[StrategyRowOutput] = []
        with_samples: list[str] = []
        for strategy in [s for s in STRATEGIES if s in by_strategy]:
            runs = by_strategy[strategy]
            cells = [_cell(metric, [metrics.get((r.id, metric.value)) for r in runs], pool=comparable_conditions)
                     for metric in SUMMARY_METRICS]
            if any(cell.valid_samples > 0 for cell in cells):
                with_samples.append(strategy)
            rows.append(StrategyRowOutput(
                strategy=strategy, runs=len(runs),
                completed_runs=sum(1 for r in runs if r.status == "COMPLETED"), metrics=cells,
            ))

        status: GroupStatus
        if not comparable_conditions:
            status = "INCOMPARABLE"
        elif len(with_samples) < 2:
            status = "INSUFFICIENT_EVIDENCE"
            reasons.append("Fewer than two strategies have valid measured samples; no comparison is drawn")
        else:
            status = "COMPARABLE"
        return StrategyGroupOutput(
            provider=provider, model=model, function_name=function_name, status=status, reasons=reasons,
            condition_keys=conditions, strategies_with_valid_samples=with_samples, strategies=rows,
        )
