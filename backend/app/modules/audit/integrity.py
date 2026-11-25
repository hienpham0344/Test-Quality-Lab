"""Project integrity verification (SHA-256 recomputation) and safe orphan artifact cleanup."""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode
from app.modules.audit.service import AuditAction, AuditService
from app.modules.datasets.models import Dataset, DatasetVersion
from app.modules.datasets.service import _snapshot_hash as compute_dataset_sha256
from app.modules.experiments.models import ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.projects.repository import ProjectRepository
from app.modules.prompts.models import PromptTemplate, PromptVersion
from app.modules.prompts.renderer import compute_template_sha256
from app.modules.reporting.csv_export import resolve_safe_artifact_path
from app.modules.reporting.models import ReportRunRecord
from app.modules.reporting.repository import load_optional_table
from app.modules.sources.models import Source, SourceVersion


def _canonical_sha256(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def compute_snapshot_sha256(snap: ExperimentSnapshot, runs: list[ExperimentSnapshotRun]) -> str:
    return _canonical_sha256(
        {
            "source_id": str(snap.source_id),
            "source_revision": snap.source_revision,
            "source_sha256": snap.source_sha256,
            "frozen_code": snap.frozen_code,
            "frozen_functions": snap.frozen_functions,
            "dataset_id": str(snap.dataset_id) if snap.dataset_id else None,
            "dataset_revision": snap.dataset_revision,
            "dataset_sha256": snap.dataset_sha256,
            "frozen_rows": snap.frozen_rows,
            "frozen_selected_rows": snap.frozen_selected_rows,
            "frozen_models": snap.frozen_models,
            "frozen_parameters": snap.frozen_parameters,
            "frozen_prompts": snap.frozen_prompts,
            "repeats": snap.repeats,
            "run_hashes": [r.run_hash for r in runs],
        }
    )


class IntegrityReportOutput(BaseModel):
    project_id: uuid.UUID
    ok: bool
    checked_records: int
    checked_artifacts: int
    violations: list[dict[str, Any]]

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)


class OrphanCleanupOutput(BaseModel):
    project_id: uuid.UUID
    dry_run: bool
    scanned_files: int
    deleted_count: int
    orphan_files: list[str]

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)


def _collect_project_artifact_refs(
    db: Session, project_id: uuid.UUID
) -> list[tuple[str, str, str | None]]:
    """Return deduplicated (run_id_str, artifact_relpath, expected_sha256) tuples for a project."""
    seen: dict[tuple[str, str], str | None] = {}

    for r in db.scalars(select(ReportRunRecord).where(ReportRunRecord.project_id == project_id)):
        if r.artifact_relpath:
            seen[(str(r.id), r.artifact_relpath)] = r.artifact_sha256

    gen_tbl = load_optional_table(db, "generation_runs")
    if gen_tbl is not None:
        for grow in db.execute(
            select(gen_tbl).where(gen_tbl.c.project_id == project_id)
        ).mappings():
            rel = grow.get("artifact_relpath")
            if rel:
                key = (str(grow["id"]), str(rel))
                if key not in seen:
                    sha = str(grow["artifact_sha256"]) if grow.get("artifact_sha256") else None
                    seen[key] = sha

    return [(rid, rel, sha) for (rid, rel), sha in sorted(seen.items())]


def verify_project_integrity(
    db: Session,
    owner_id: uuid.UUID,
    project_id: uuid.UUID,
    artifact_dir: str | Path | None = None,
) -> IntegrityReportOutput:
    if ProjectRepository(db).get(owner_id, project_id) is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    effective_artifact_dir = (
        str(artifact_dir) if artifact_dir is not None else get_settings().artifact_dir
    )
    checked_records = 0
    checked_artifacts = 0
    violations: list[dict[str, Any]] = []

    # 1. SourceVersion SHA-256 & byte_size
    source_ids = list(db.scalars(select(Source.id).where(Source.project_id == project_id)))
    if source_ids:
        for sv in db.scalars(
            select(SourceVersion)
            .where(SourceVersion.source_id.in_(source_ids))
            .order_by(SourceVersion.source_id, SourceVersion.revision)
        ):
            checked_records += 1
            encoded = sv.code.encode("utf-8")
            actual_sha = hashlib.sha256(encoded).hexdigest()
            if actual_sha != sv.sha256 or len(encoded) != sv.byte_size:
                violations.append(
                    {
                        "entity": "source_version",
                        "id": str(sv.id),
                        "kind": "hash_mismatch",
                        "expected_sha256": sv.sha256,
                        "actual_sha256": actual_sha,
                    }
                )

    # 2. DatasetVersion SHA-256
    dataset_ids = list(db.scalars(select(Dataset.id).where(Dataset.project_id == project_id)))
    if dataset_ids:
        for dv in db.scalars(
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id.in_(dataset_ids))
            .order_by(DatasetVersion.dataset_id, DatasetVersion.revision)
        ):
            checked_records += 1
            actual_ds_sha = compute_dataset_sha256(
                dv.input_rows,
                dv.selected_rows,
                dv.reference_source_id,
                dv.reference_revision,
            )
            if actual_ds_sha != dv.sha256:
                violations.append(
                    {
                        "entity": "dataset_version",
                        "id": str(dv.id),
                        "kind": "hash_mismatch",
                        "expected_sha256": dv.sha256,
                        "actual_sha256": actual_ds_sha,
                    }
                )

    # 3. PromptVersion SHA-256
    template_ids = list(
        db.scalars(select(PromptTemplate.id).where(PromptTemplate.project_id == project_id))
    )
    if template_ids:
        for pv in db.scalars(
            select(PromptVersion)
            .where(PromptVersion.template_id.in_(template_ids))
            .order_by(PromptVersion.template_id, PromptVersion.version)
        ):
            checked_records += 1
            actual_pv_sha = compute_template_sha256(
                pv.strategy, pv.system_template, pv.user_template
            )
            if actual_pv_sha != pv.sha256:
                violations.append(
                    {
                        "entity": "prompt_version",
                        "id": str(pv.id),
                        "kind": "hash_mismatch",
                        "expected_sha256": pv.sha256,
                        "actual_sha256": actual_pv_sha,
                    }
                )

    # 4. ExperimentSnapshot SHA-256
    for snap in db.scalars(
        select(ExperimentSnapshot)
        .where(ExperimentSnapshot.project_id == project_id)
        .order_by(ExperimentSnapshot.created_at, ExperimentSnapshot.id)
    ):
        checked_records += 1
        snap_runs = list(
            db.scalars(
                select(ExperimentSnapshotRun)
                .where(ExperimentSnapshotRun.snapshot_id == snap.id)
                .order_by(ExperimentSnapshotRun.ordinal.asc())
            )
        )
        actual_snap_sha = compute_snapshot_sha256(snap, snap_runs)
        if actual_snap_sha != snap.snapshot_sha256:
            violations.append(
                {
                    "entity": "experiment_snapshot",
                    "id": str(snap.id),
                    "kind": "hash_mismatch",
                    "expected_sha256": snap.snapshot_sha256,
                    "actual_sha256": actual_snap_sha,
                }
            )

    # 5. On-disk artifacts
    for run_id_str, relpath, expected_sha in _collect_project_artifact_refs(db, project_id):
        checked_artifacts += 1
        try:
            resolved = resolve_safe_artifact_path(effective_artifact_dir, relpath)
        except AppError as exc:
            violations.append(
                {
                    "entity": "artifact",
                    "id": run_id_str,
                    "relpath": relpath,
                    "kind": "artifact_unsafe_path",
                    "reason": exc.message,
                }
            )
            continue

        if not resolved.exists() or not resolved.is_file():
            violations.append(
                {
                    "entity": "artifact",
                    "id": run_id_str,
                    "relpath": relpath,
                    "kind": "artifact_missing",
                }
            )
            continue

        disk_sha = hashlib.sha256(resolved.read_bytes()).hexdigest()
        if expected_sha is not None and disk_sha != expected_sha:
            violations.append(
                {
                    "entity": "artifact",
                    "id": run_id_str,
                    "relpath": relpath,
                    "kind": "artifact_hash_mismatch",
                    "expected_sha256": expected_sha,
                    "actual_sha256": disk_sha,
                }
            )

    return IntegrityReportOutput(
        project_id=project_id,
        ok=(len(violations) == 0),
        checked_records=checked_records,
        checked_artifacts=checked_artifacts,
        violations=violations,
    )


def _walk_safe_files(root_dir: Path, artifact_root: Path) -> list[Path]:
    """Recursively enumerate regular files inside root_dir, failing closed on any symlink."""
    files: list[Path] = []
    if not root_dir.exists():
        return files
    if root_dir.is_symlink():
        raise AppError(ErrorCode.ACCESS_DENIED, "Symlinked project artifact directory is forbidden")
    resolved_dir = root_dir.resolve()
    if not resolved_dir.is_relative_to(artifact_root):
        raise AppError(ErrorCode.ACCESS_DENIED, "Project artifact directory escapes artifact_dir")

    for entry in sorted(root_dir.iterdir(), key=lambda p: p.name):
        if entry.is_symlink():
            raise AppError(ErrorCode.ACCESS_DENIED, "Symlink detected in artifact directory")
        resolved_entry = entry.resolve()
        if not resolved_entry.is_relative_to(artifact_root) or not resolved_entry.is_relative_to(
            resolved_dir
        ):
            raise AppError(ErrorCode.ACCESS_DENIED, "Artifact entry escapes project root")
        if entry.is_dir():
            files.extend(_walk_safe_files(entry, artifact_root))
        elif entry.is_file():
            files.append(resolved_entry)
    return files


def cleanup_orphan_artifacts(
    db: Session,
    owner_id: uuid.UUID,
    project_id: uuid.UUID,
    artifact_dir: str | Path | None = None,
    *,
    dry_run: bool = False,
) -> OrphanCleanupOutput:
    if ProjectRepository(db).get(owner_id, project_id) is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    effective_dir = Path(
        str(artifact_dir) if artifact_dir is not None else get_settings().artifact_dir
    )
    if effective_dir.is_symlink():
        raise AppError(ErrorCode.ACCESS_DENIED, "Symlinked artifact_dir root is forbidden")
    artifact_root = effective_dir.resolve()
    project_dir = artifact_root / str(project_id)

    referenced_resolved: set[Path] = set()
    for _, relpath, _ in _collect_project_artifact_refs(db, project_id):
        try:
            referenced_resolved.add(resolve_safe_artifact_path(artifact_root, relpath))
        except AppError:
            continue

    all_files = _walk_safe_files(project_dir, artifact_root)
    orphan_paths = [f for f in all_files if f not in referenced_resolved]
    orphan_relpaths = [f.relative_to(artifact_root).as_posix() for f in orphan_paths]

    deleted_count = 0
    if not dry_run:
        for orphan_file in orphan_paths:
            orphan_file.unlink()
            deleted_count += 1
        AuditService(db).record(AuditAction.SYSTEM_ARTIFACT_CLEANUP, owner_id)
        db.commit()

    return OrphanCleanupOutput(
        project_id=project_id,
        dry_run=dry_run,
        scanned_files=len(all_files),
        deleted_count=deleted_count,
        orphan_files=orphan_relpaths,
    )


class IntegrityService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def verify_project_integrity(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        artifact_dir: str | Path | None = None,
    ) -> IntegrityReportOutput:
        return verify_project_integrity(self.db, owner_id, project_id, artifact_dir)

    def cleanup_orphan_artifacts(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        artifact_dir: str | Path | None = None,
        *,
        dry_run: bool = False,
    ) -> OrphanCleanupOutput:
        return cleanup_orphan_artifacts(
            self.db, owner_id, project_id, artifact_dir, dry_run=dry_run
        )
