"""Deterministic secret-free project backup export and checksum-verified restore."""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets
from app.modules.audit.integrity import _collect_project_artifact_refs
from app.modules.audit.service import AuditAction, AuditService
from app.modules.datasets.models import Dataset, DatasetVersion
from app.modules.datasets.service import _snapshot_hash as compute_dataset_sha256
from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.projects.models import Project, ProjectHistory
from app.modules.projects.repository import ProjectRepository
from app.modules.prompts.models import PromptTemplate, PromptVersion
from app.modules.prompts.renderer import compute_template_sha256, extract_template_variables
from app.modules.reporting.csv_export import resolve_safe_artifact_path
from app.modules.sources.models import Source, SourceVersion
from app.modules.sources.policy import SourcePolicyError, inspect_python

BACKUP_SCHEMA_VERSION = "1.0"
REQUIRED_BUNDLE_KEYS = frozenset(
    {
        "schema_version",
        "project",
        "project_history",
        "sources",
        "datasets",
        "prompts",
        "experiments",
        "snapshots",
        "artifact_checksums",
        "bundle_sha256",
    }
)


def _canonical_sha256(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _scrub_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_secrets(value)
    if isinstance(value, list):
        return [_scrub_value(item) for item in value]
    if isinstance(value, dict):
        return {str(k): _scrub_value(v) for k, v in value.items()}
    return value


def _parse_iso_dt(raw: Any, *, fallback: datetime) -> datetime:
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None)
    if isinstance(raw, str) and raw.strip():
        cleaned = raw.strip()
        if cleaned.endswith(("Z", "z")):
            cleaned = f"{cleaned[:-1]}+00:00"
        try:
            return datetime.fromisoformat(cleaned).replace(tzinfo=None)
        except ValueError:
            return fallback
    return fallback


class BackupRestoreOutput(BaseModel):
    project_id: uuid.UUID
    name: str
    restored_sources: int
    restored_datasets: int
    restored_prompts: int
    restored_experiments: int
    restored_snapshots: int

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)


def export_project_backup(
    db: Session,
    owner_id: uuid.UUID,
    project_id: uuid.UUID,
    artifact_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Export deterministic secret-free project JSON bundle (strictly omitting credentials)."""
    project = ProjectRepository(db).get(owner_id, project_id)
    if project is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    effective_artifact_dir = (
        str(artifact_dir) if artifact_dir is not None else get_settings().artifact_dir
    )

    history_rows = list(
        db.scalars(
            select(ProjectHistory)
            .where(ProjectHistory.project_id == project_id)
            .order_by(ProjectHistory.revision.asc())
        )
    )
    project_history_out = [
        {
            "revision": h.revision,
            "name": redact_secrets(h.name),
            "description": redact_secrets(h.description) if h.description is not None else None,
            "changed_at": h.changed_at.isoformat() + "Z",
        }
        for h in history_rows
    ]

    # Sources + SourceVersions
    sources_out: list[dict[str, Any]] = []
    for src in db.scalars(
        select(Source)
        .where(Source.project_id == project_id)
        .order_by(Source.created_at.asc(), Source.id.asc())
    ):
        versions = list(
            db.scalars(
                select(SourceVersion)
                .where(SourceVersion.source_id == src.id)
                .order_by(SourceVersion.revision.asc())
            )
        )
        ver_list: list[dict[str, Any]] = []
        for sv in versions:
            clean_code = redact_secrets(sv.code)
            code_bytes = clean_code.encode("utf-8")
            ver_list.append(
                {
                    "id": str(sv.id),
                    "revision": sv.revision,
                    "sha256": hashlib.sha256(code_bytes).hexdigest(),
                    "byte_size": len(code_bytes),
                    "code": clean_code,
                    "created_at": sv.created_at.isoformat() + "Z",
                }
            )
        sources_out.append(
            {
                "id": str(src.id),
                "current_revision": src.current_revision,
                "created_at": src.created_at.isoformat() + "Z",
                "updated_at": src.updated_at.isoformat() + "Z",
                "versions": ver_list,
            }
        )

    # Datasets + DatasetVersions
    datasets_out: list[dict[str, Any]] = []
    for ds in db.scalars(
        select(Dataset)
        .where(Dataset.project_id == project_id)
        .order_by(Dataset.created_at.asc(), Dataset.id.asc())
    ):
        d_versions = list(
            db.scalars(
                select(DatasetVersion)
                .where(DatasetVersion.dataset_id == ds.id)
                .order_by(DatasetVersion.revision.asc())
            )
        )
        dver_list: list[dict[str, Any]] = []
        for dv in d_versions:
            clean_inputs = _scrub_value(dv.input_rows)
            clean_rows = _scrub_value(dv.rows)
            ds_sha = compute_dataset_sha256(
                clean_inputs,
                dv.selected_rows,
                dv.reference_source_id,
                dv.reference_revision,
            )
            dver_list.append(
                {
                    "id": str(dv.id),
                    "revision": dv.revision,
                    "sha256": ds_sha,
                    "input_rows": clean_inputs,
                    "rows": clean_rows,
                    "selected_rows": list(dv.selected_rows),
                    "reference_source_id": (
                        str(dv.reference_source_id) if dv.reference_source_id else None
                    ),
                    "reference_revision": dv.reference_revision,
                    "created_at": dv.created_at.isoformat() + "Z",
                }
            )
        datasets_out.append(
            {
                "id": str(ds.id),
                "current_revision": ds.current_revision,
                "created_at": ds.created_at.isoformat() + "Z",
                "updated_at": ds.updated_at.isoformat() + "Z",
                "versions": dver_list,
            }
        )

    # Prompts + PromptVersions
    prompts_out: list[dict[str, Any]] = []
    for tpl in db.scalars(
        select(PromptTemplate)
        .where(PromptTemplate.project_id == project_id)
        .order_by(PromptTemplate.strategy.asc())
    ):
        p_versions = list(
            db.scalars(
                select(PromptVersion)
                .where(PromptVersion.template_id == tpl.id)
                .order_by(PromptVersion.version.asc())
            )
        )
        pver_list: list[dict[str, Any]] = []
        for pv in p_versions:
            clean_sys = redact_secrets(pv.system_template) if pv.system_template is not None else None
            clean_usr = redact_secrets(pv.user_template)
            pver_list.append(
                {
                    "id": str(pv.id),
                    "strategy": pv.strategy,
                    "version": pv.version,
                    "status": pv.status,
                    "system_template": clean_sys,
                    "user_template": clean_usr,
                    "required_variables": list(pv.required_variables),
                    "sha256": compute_template_sha256(pv.strategy, clean_sys, clean_usr),
                    "notes": redact_secrets(pv.notes) if pv.notes is not None else None,
                    "approved_at": pv.approved_at.isoformat() + "Z" if pv.approved_at else None,
                    "created_at": pv.created_at.isoformat() + "Z",
                }
            )
        prompts_out.append(
            {
                "id": str(tpl.id),
                "strategy": tpl.strategy,
                "title": redact_secrets(tpl.title),
                "current_version": tpl.current_version,
                "approved_version": tpl.approved_version,
                "created_at": tpl.created_at.isoformat() + "Z",
                "updated_at": tpl.updated_at.isoformat() + "Z",
                "versions": pver_list,
            }
        )

    # Experiments
    experiments_out: list[dict[str, Any]] = []
    for exp in db.scalars(
        select(Experiment)
        .where(Experiment.project_id == project_id)
        .order_by(Experiment.created_at.asc(), Experiment.id.asc())
    ):
        experiments_out.append(
            {
                "id": str(exp.id),
                "name": redact_secrets(exp.name),
                "description": (
                    redact_secrets(exp.description) if exp.description is not None else None
                ),
                "draft_config": _scrub_value(exp.draft_config),
                "latest_snapshot_number": exp.latest_snapshot_number,
                "created_at": exp.created_at.isoformat() + "Z",
                "updated_at": exp.updated_at.isoformat() + "Z",
            }
        )

    # Frozen Snapshots + Planned Snapshot Runs
    snapshots_out: list[dict[str, Any]] = []
    for snap in db.scalars(
        select(ExperimentSnapshot)
        .where(ExperimentSnapshot.project_id == project_id)
        .order_by(
            ExperimentSnapshot.created_at.asc(),
            ExperimentSnapshot.snapshot_number.asc(),
            ExperimentSnapshot.id.asc(),
        )
    ):
        s_runs = list(
            db.scalars(
                select(ExperimentSnapshotRun)
                .where(ExperimentSnapshotRun.snapshot_id == snap.id)
                .order_by(ExperimentSnapshotRun.ordinal.asc())
            )
        )
        clean_code = redact_secrets(snap.frozen_code)
        clean_src_sha = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()
        clean_fns = _scrub_value(snap.frozen_functions)
        clean_rows = _scrub_value(snap.frozen_rows)
        clean_models = [
            {
                "provider": redact_secrets(str(m.get("provider", ""))),
                "model": redact_secrets(str(m.get("model", ""))),
                "credential_key_id": redact_secrets(str(m.get("credential_key_id", ""))),
                "credential_key_hint": redact_secrets(str(m.get("credential_key_hint", ""))),
            }
            for m in snap.frozen_models
        ]
        clean_params = _scrub_value(snap.frozen_parameters)
        clean_prompts = _scrub_value(snap.frozen_prompts)

        run_items = [
            {
                "id": str(r.id),
                "ordinal": r.ordinal,
                "function_name": r.function_name,
                "function_line": r.function_line,
                "provider": r.provider,
                "model": r.model,
                "strategy": r.strategy,
                "prompt_version": r.prompt_version,
                "prompt_sha256": r.prompt_sha256,
                "rendered_prompt_sha256": r.rendered_prompt_sha256,
                "repeat_index": r.repeat_index,
                "run_hash": r.run_hash,
            }
            for r in s_runs
        ]
        snap_sha = _canonical_sha256(
            {
                "source_id": str(snap.source_id),
                "source_revision": snap.source_revision,
                "source_sha256": clean_src_sha,
                "frozen_code": clean_code,
                "frozen_functions": clean_fns,
                "dataset_id": str(snap.dataset_id) if snap.dataset_id else None,
                "dataset_revision": snap.dataset_revision,
                "dataset_sha256": snap.dataset_sha256,
                "frozen_rows": clean_rows,
                "frozen_selected_rows": snap.frozen_selected_rows,
                "frozen_models": clean_models,
                "frozen_parameters": clean_params,
                "frozen_prompts": clean_prompts,
                "repeats": snap.repeats,
                "run_hashes": [r["run_hash"] for r in run_items],
            }
        )
        snapshots_out.append(
            {
                "id": str(snap.id),
                "experiment_id": str(snap.experiment_id),
                "snapshot_number": snap.snapshot_number,
                "source_id": str(snap.source_id),
                "source_revision": snap.source_revision,
                "source_sha256": clean_src_sha,
                "frozen_code": clean_code,
                "frozen_functions": clean_fns,
                "dataset_id": str(snap.dataset_id) if snap.dataset_id else None,
                "dataset_revision": snap.dataset_revision,
                "dataset_sha256": snap.dataset_sha256,
                "frozen_rows": clean_rows,
                "frozen_selected_rows": snap.frozen_selected_rows,
                "frozen_models": clean_models,
                "frozen_parameters": clean_params,
                "frozen_prompts": clean_prompts,
                "repeats": snap.repeats,
                "run_count": snap.run_count,
                "snapshot_sha256": snap_sha,
                "created_at": snap.created_at.isoformat() + "Z",
                "runs": run_items,
            }
        )

    # Artifact checksums manifest (safe path verified)
    artifact_checksums: list[dict[str, Any]] = []
    for run_id_str, relpath, expected_sha in _collect_project_artifact_refs(db, project_id):
        on_disk_sha: str | None = None
        exists = False
        try:
            resolved = resolve_safe_artifact_path(effective_artifact_dir, relpath)
            if resolved.exists() and resolved.is_file():
                exists = True
                on_disk_sha = hashlib.sha256(resolved.read_bytes()).hexdigest()
        except AppError:
            exists = False
        artifact_checksums.append(
            {
                "run_id": run_id_str,
                "artifact_relpath": redact_secrets(relpath),
                "expected_sha256": expected_sha,
                "on_disk_sha256": on_disk_sha,
                "exists": exists,
            }
        )

    bundle_without_sha: dict[str, Any] = {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "exported_at": utcnow().isoformat() + "Z",
        "project": {
            "id": str(project.id),
            "name": redact_secrets(project.name),
            "description": (
                redact_secrets(project.description) if project.description is not None else None
            ),
            "current_revision": project.current_revision,
            "created_at": project.created_at.isoformat() + "Z",
            "updated_at": project.updated_at.isoformat() + "Z",
        },
        "project_history": project_history_out,
        "sources": sources_out,
        "datasets": datasets_out,
        "prompts": prompts_out,
        "experiments": experiments_out,
        "snapshots": snapshots_out,
        "artifact_checksums": artifact_checksums,
    }
    bundle_sha = _canonical_sha256(bundle_without_sha)
    bundle = {**bundle_without_sha, "bundle_sha256": bundle_sha}

    AuditService(db).record(AuditAction.SYSTEM_BACKUP_EXPORTED, owner_id)
    db.commit()
    return bundle


def _verify_bundle_integrity(bundle: dict[str, Any]) -> None:
    if not isinstance(bundle, dict):
        raise AppError(ErrorCode.INPUT_INVALID, "Backup bundle must be a JSON object")

    missing = REQUIRED_BUNDLE_KEYS - set(bundle.keys())
    if missing:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Backup bundle is missing required sections",
            {k: "Required" for k in sorted(missing)},
        )

    if bundle.get("schema_version") != BACKUP_SCHEMA_VERSION:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            f"Unsupported backup schema_version: {bundle.get('schema_version')!r}",
            {"schema_version": f"Expected {BACKUP_SCHEMA_VERSION}"},
        )

    if "provider_credentials" in bundle:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Backup bundles must never embed provider_credentials",
            {"provider_credentials": "Forbidden in backup bundle"},
        )

    payload_without_sha = {k: v for k, v in bundle.items() if k != "bundle_sha256"}
    expected_bundle_sha = _canonical_sha256(payload_without_sha)
    provided_bundle_sha = str(bundle.get("bundle_sha256") or "")
    if not hmac.compare_digest(expected_bundle_sha, provided_bundle_sha):
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Backup bundle SHA-256 mismatch (tampered payload)",
            {"bundle_sha256": "Checksum mismatch"},
        )

    # Verify every SourceVersion SHA-256, byte_size, and static AST policy
    for src in bundle.get("sources", []):
        for ver in src.get("versions", []):
            code = ver.get("code")
            if not isinstance(code, str):
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "Invalid source code in backup bundle",
                    {"sources": "code must be string"},
                )
            encoded = code.encode("utf-8")
            actual_sha = hashlib.sha256(encoded).hexdigest()
            if not hmac.compare_digest(actual_sha, str(ver.get("sha256", ""))) or int(
                ver.get("byte_size", -1)
            ) != len(encoded):
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "SourceVersion SHA-256 verification failed",
                    {"sources": f"Tampered source version {ver.get('id')}"},
                )
            try:
                inspect_python(code)
            except SourcePolicyError as exc:
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    f"SourceVersion failed policy validation: {exc}",
                    {"sources": str(exc)},
                ) from exc

    # Verify every DatasetVersion SHA-256
    for ds in bundle.get("datasets", []):
        for ver in ds.get("versions", []):
            ref_src_raw = ver.get("reference_source_id")
            ref_src_uuid = uuid.UUID(str(ref_src_raw)) if ref_src_raw else None
            actual_ds_sha = compute_dataset_sha256(
                ver.get("input_rows", []),
                ver.get("selected_rows", []),
                ref_src_uuid,
                ver.get("reference_revision"),
            )
            if not hmac.compare_digest(actual_ds_sha, str(ver.get("sha256", ""))):
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "DatasetVersion SHA-256 verification failed",
                    {"datasets": f"Tampered dataset version {ver.get('id')}"},
                )

    # Verify every PromptVersion SHA-256 & safe placeholders
    for tpl in bundle.get("prompts", []):
        for ver in tpl.get("versions", []):
            strategy = str(ver.get("strategy", ""))
            sys_tpl = ver.get("system_template")
            usr_tpl = ver.get("user_template")
            if not isinstance(usr_tpl, str):
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "Invalid user_template in backup bundle",
                    {"prompts": "user_template must be string"},
                )
            extract_template_variables(sys_tpl, usr_tpl)
            actual_pv_sha = compute_template_sha256(strategy, sys_tpl, usr_tpl)
            if not hmac.compare_digest(actual_pv_sha, str(ver.get("sha256", ""))):
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "PromptVersion SHA-256 verification failed",
                    {"prompts": f"Tampered prompt version {ver.get('id')}"},
                )

    # Verify every ExperimentSnapshot SHA-256
    for snap in bundle.get("snapshots", []):
        runs = snap.get("runs", [])
        actual_snap_sha = _canonical_sha256(
            {
                "source_id": snap.get("source_id"),
                "source_revision": snap.get("source_revision"),
                "source_sha256": snap.get("source_sha256"),
                "frozen_code": snap.get("frozen_code"),
                "frozen_functions": snap.get("frozen_functions"),
                "dataset_id": snap.get("dataset_id"),
                "dataset_revision": snap.get("dataset_revision"),
                "dataset_sha256": snap.get("dataset_sha256"),
                "frozen_rows": snap.get("frozen_rows"),
                "frozen_selected_rows": snap.get("frozen_selected_rows"),
                "frozen_models": snap.get("frozen_models"),
                "frozen_parameters": snap.get("frozen_parameters"),
                "frozen_prompts": snap.get("frozen_prompts"),
                "repeats": snap.get("repeats"),
                "run_hashes": [r.get("run_hash") for r in runs],
            }
        )
        if not hmac.compare_digest(actual_snap_sha, str(snap.get("snapshot_sha256", ""))):
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "ExperimentSnapshot SHA-256 verification failed",
                {"snapshots": f"Tampered snapshot {snap.get('id')}"},
            )


def restore_project_backup(
    db: Session,
    owner_id: uuid.UUID,
    bundle: dict[str, Any],
) -> BackupRestoreOutput:
    """Verify bundle_sha256 & all inner entity SHA-256s, then restore into a new owned project."""
    _verify_bundle_integrity(bundle)

    now = utcnow()
    proj_data = bundle["project"]
    raw_name = redact_secrets(str(proj_data.get("name") or "")).strip()
    if not raw_name or len(raw_name) > 120:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Invalid project name in backup bundle",
            {"project.name": "Must be 1..120 characters"},
        )
    raw_desc = proj_data.get("description")
    clean_desc = redact_secrets(str(raw_desc)) if raw_desc is not None else None

    new_project_id = uuid.uuid4()
    new_project = Project(
        id=new_project_id,
        owner_id=owner_id,
        name=raw_name,
        description=clean_desc,
        current_revision=int(proj_data.get("current_revision") or 1),
        created_at=now,
        updated_at=now,
    )
    db.add(new_project)
    db.flush()

    history_items = bundle.get("project_history") or []
    if history_items:
        for h in history_items:
            db.add(
                ProjectHistory(
                    id=uuid.uuid4(),
                    project_id=new_project_id,
                    revision=int(h["revision"]),
                    name=redact_secrets(str(h["name"])),
                    description=(
                        redact_secrets(str(h["description"]))
                        if h.get("description") is not None
                        else None
                    ),
                    changed_at=_parse_iso_dt(h.get("changed_at"), fallback=now),
                )
            )
    else:
        db.add(
            ProjectHistory(
                id=uuid.uuid4(),
                project_id=new_project_id,
                revision=1,
                name=raw_name,
                description=clean_desc,
                changed_at=now,
            )
        )

    source_id_map: dict[str, uuid.UUID] = {}
    for src_data in bundle.get("sources", []):
        old_src_id = str(src_data["id"])
        new_src_id = uuid.uuid4()
        source_id_map[old_src_id] = new_src_id
        db.add(
            Source(
                id=new_src_id,
                project_id=new_project_id,
                current_revision=int(src_data["current_revision"]),
                created_at=_parse_iso_dt(src_data.get("created_at"), fallback=now),
                updated_at=_parse_iso_dt(src_data.get("updated_at"), fallback=now),
            )
        )
        db.flush()
        for sv_data in src_data.get("versions", []):
            code = redact_secrets(str(sv_data["code"]))
            encoded = code.encode("utf-8")
            db.add(
                SourceVersion(
                    id=uuid.uuid4(),
                    source_id=new_src_id,
                    revision=int(sv_data["revision"]),
                    sha256=hashlib.sha256(encoded).hexdigest(),
                    byte_size=len(encoded),
                    code=code,
                    created_at=_parse_iso_dt(sv_data.get("created_at"), fallback=now),
                )
            )

    dataset_id_map: dict[str, uuid.UUID] = {}
    dataset_rev_sha_map: dict[tuple[str, int], str] = {}
    for ds_data in bundle.get("datasets", []):
        old_ds_id = str(ds_data["id"])
        new_ds_id = uuid.uuid4()
        dataset_id_map[old_ds_id] = new_ds_id
        db.add(
            Dataset(
                id=new_ds_id,
                project_id=new_project_id,
                current_revision=int(ds_data["current_revision"]),
                created_at=_parse_iso_dt(ds_data.get("created_at"), fallback=now),
                updated_at=_parse_iso_dt(ds_data.get("updated_at"), fallback=now),
            )
        )
        db.flush()
        for dv_data in ds_data.get("versions", []):
            old_ref = dv_data.get("reference_source_id")
            mapped_ref = (
                source_id_map.get(str(old_ref), uuid.UUID(str(old_ref))) if old_ref else None
            )
            rev = int(dv_data["revision"])
            clean_inputs = _scrub_value(dv_data["input_rows"])
            clean_rows = _scrub_value(dv_data["rows"])
            selected = list(dv_data["selected_rows"])
            ref_rev = dv_data.get("reference_revision")
            new_ds_sha = compute_dataset_sha256(clean_inputs, selected, mapped_ref, ref_rev)
            dataset_rev_sha_map[(old_ds_id, rev)] = new_ds_sha
            db.add(
                DatasetVersion(
                    id=uuid.uuid4(),
                    dataset_id=new_ds_id,
                    revision=rev,
                    sha256=new_ds_sha,
                    input_rows=clean_inputs,
                    rows=clean_rows,
                    selected_rows=selected,
                    reference_source_id=mapped_ref,
                    reference_revision=ref_rev,
                    created_at=_parse_iso_dt(dv_data.get("created_at"), fallback=now),
                )
            )

    template_id_map: dict[str, uuid.UUID] = {}
    restored_prompt_versions = 0
    for tpl_data in bundle.get("prompts", []):
        old_tpl_id = str(tpl_data["id"])
        new_tpl_id = uuid.uuid4()
        template_id_map[old_tpl_id] = new_tpl_id
        db.add(
            PromptTemplate(
                id=new_tpl_id,
                project_id=new_project_id,
                strategy=str(tpl_data["strategy"]),
                title=redact_secrets(str(tpl_data["title"])),
                current_version=int(tpl_data["current_version"]),
                approved_version=tpl_data.get("approved_version"),
                created_at=_parse_iso_dt(tpl_data.get("created_at"), fallback=now),
                updated_at=_parse_iso_dt(tpl_data.get("updated_at"), fallback=now),
            )
        )
        db.flush()
        for pv_data in tpl_data.get("versions", []):
            restored_prompt_versions += 1
            sys_tpl = (
                redact_secrets(str(pv_data["system_template"]))
                if pv_data.get("system_template") is not None
                else None
            )
            usr_tpl = redact_secrets(str(pv_data["user_template"]))
            strat = str(pv_data["strategy"])
            db.add(
                PromptVersion(
                    id=uuid.uuid4(),
                    template_id=new_tpl_id,
                    strategy=strat,
                    version=int(pv_data["version"]),
                    status=str(pv_data["status"]),
                    system_template=sys_tpl,
                    user_template=usr_tpl,
                    required_variables=list(pv_data["required_variables"]),
                    sha256=compute_template_sha256(strat, sys_tpl, usr_tpl),
                    notes=(
                        redact_secrets(str(pv_data["notes"]))
                        if pv_data.get("notes") is not None
                        else None
                    ),
                    created_by=owner_id,
                    approved_at=(
                        _parse_iso_dt(pv_data.get("approved_at"), fallback=now)
                        if pv_data.get("approved_at")
                        else None
                    ),
                    created_at=_parse_iso_dt(pv_data.get("created_at"), fallback=now),
                )
            )

    exp_id_map: dict[str, uuid.UUID] = {}
    for exp_data in bundle.get("experiments", []):
        old_exp_id = str(exp_data["id"])
        new_exp_id = uuid.uuid4()
        exp_id_map[old_exp_id] = new_exp_id
        draft_cfg = copy.deepcopy(_scrub_value(exp_data["draft_config"]))
        if isinstance(draft_cfg, dict):
            old_cfg_src = draft_cfg.get("source_id")
            if old_cfg_src and str(old_cfg_src) in source_id_map:
                draft_cfg["source_id"] = str(source_id_map[str(old_cfg_src)])
            old_cfg_ds = draft_cfg.get("dataset_id")
            if old_cfg_ds and str(old_cfg_ds) in dataset_id_map:
                draft_cfg["dataset_id"] = str(dataset_id_map[str(old_cfg_ds)])
        db.add(
            Experiment(
                id=new_exp_id,
                project_id=new_project_id,
                name=redact_secrets(str(exp_data["name"])),
                description=(
                    redact_secrets(str(exp_data["description"]))
                    if exp_data.get("description") is not None
                    else None
                ),
                draft_config=draft_cfg,
                latest_snapshot_number=int(exp_data.get("latest_snapshot_number") or 0),
                created_at=_parse_iso_dt(exp_data.get("created_at"), fallback=now),
                updated_at=_parse_iso_dt(exp_data.get("updated_at"), fallback=now),
            )
        )
    db.flush()

    restored_snapshots = 0
    for snap_data in bundle.get("snapshots", []):
        restored_snapshots += 1
        new_snap_id = uuid.uuid4()
        old_exp_id = str(snap_data["experiment_id"])
        mapped_exp_id = exp_id_map.get(old_exp_id)
        if mapped_exp_id is None:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Snapshot references unknown experiment_id in backup bundle",
                {"snapshots": old_exp_id},
            )
        old_src_id = str(snap_data["source_id"])
        mapped_src_id = source_id_map.get(old_src_id, uuid.UUID(old_src_id))

        old_ds_raw = snap_data.get("dataset_id")
        mapped_ds_id = (
            dataset_id_map.get(str(old_ds_raw), uuid.UUID(str(old_ds_raw)))
            if old_ds_raw
            else None
        )
        ds_rev = snap_data.get("dataset_revision")
        mapped_ds_sha = (
            dataset_rev_sha_map.get((str(old_ds_raw), int(ds_rev)), snap_data.get("dataset_sha256"))
            if old_ds_raw and ds_rev is not None
            else snap_data.get("dataset_sha256")
        )

        remapped_prompts = copy.deepcopy(_scrub_value(snap_data["frozen_prompts"]))
        if isinstance(remapped_prompts, dict):
            for p_entry in remapped_prompts.values():
                if isinstance(p_entry, dict) and p_entry.get("template_id"):
                    old_tid = str(p_entry["template_id"])
                    if old_tid in template_id_map:
                        p_entry["template_id"] = str(template_id_map[old_tid])

        frozen_params = _scrub_value(snap_data["frozen_parameters"])
        src_sha = str(snap_data["source_sha256"])
        new_runs: list[ExperimentSnapshotRun] = []
        for r_data in snap_data.get("runs", []):
            recomputed_run_hash = _canonical_sha256(
                {
                    "source_sha256": src_sha,
                    "dataset_sha256": mapped_ds_sha,
                    "function_name": r_data["function_name"],
                    "function_line": int(r_data["function_line"]),
                    "provider": r_data["provider"],
                    "model": r_data["model"],
                    "strategy": r_data["strategy"],
                    "prompt_version": int(r_data["prompt_version"]),
                    "prompt_sha256": r_data["prompt_sha256"],
                    "rendered_prompt_sha256": r_data["rendered_prompt_sha256"],
                    "parameters": frozen_params,
                    "repeat_index": int(r_data["repeat_index"]),
                }
            )
            new_runs.append(
                ExperimentSnapshotRun(
                    id=uuid.uuid4(),
                    snapshot_id=new_snap_id,
                    ordinal=int(r_data["ordinal"]),
                    function_name=str(r_data["function_name"]),
                    function_line=int(r_data["function_line"]),
                    provider=str(r_data["provider"]),
                    model=str(r_data["model"]),
                    strategy=str(r_data["strategy"]),
                    prompt_version=int(r_data["prompt_version"]),
                    prompt_sha256=str(r_data["prompt_sha256"]),
                    rendered_prompt_sha256=str(r_data["rendered_prompt_sha256"]),
                    repeat_index=int(r_data["repeat_index"]),
                    run_hash=recomputed_run_hash,
                )
            )

        frozen_code = redact_secrets(str(snap_data["frozen_code"]))
        frozen_fns = _scrub_value(snap_data["frozen_functions"])
        frozen_rows = _scrub_value(snap_data.get("frozen_rows"))
        frozen_sel = snap_data.get("frozen_selected_rows")
        frozen_models = _scrub_value(snap_data["frozen_models"])
        repeats = int(snap_data["repeats"])

        recomputed_snap_sha = _canonical_sha256(
            {
                "source_id": str(mapped_src_id),
                "source_revision": int(snap_data["source_revision"]),
                "source_sha256": src_sha,
                "frozen_code": frozen_code,
                "frozen_functions": frozen_fns,
                "dataset_id": str(mapped_ds_id) if mapped_ds_id else None,
                "dataset_revision": ds_rev,
                "dataset_sha256": mapped_ds_sha,
                "frozen_rows": frozen_rows,
                "frozen_selected_rows": frozen_sel,
                "frozen_models": frozen_models,
                "frozen_parameters": frozen_params,
                "frozen_prompts": remapped_prompts,
                "repeats": repeats,
                "run_hashes": [r.run_hash for r in new_runs],
            }
        )
        db.add(
            ExperimentSnapshot(
                id=new_snap_id,
                experiment_id=mapped_exp_id,
                project_id=new_project_id,
                snapshot_number=int(snap_data["snapshot_number"]),
                source_id=mapped_src_id,
                source_revision=int(snap_data["source_revision"]),
                source_sha256=src_sha,
                frozen_code=frozen_code,
                frozen_functions=frozen_fns,
                dataset_id=mapped_ds_id,
                dataset_revision=ds_rev,
                dataset_sha256=mapped_ds_sha,
                frozen_rows=frozen_rows,
                frozen_selected_rows=frozen_sel,
                frozen_models=frozen_models,
                frozen_parameters=frozen_params,
                frozen_prompts=remapped_prompts,
                repeats=repeats,
                run_count=len(new_runs),
                snapshot_sha256=recomputed_snap_sha,
                created_at=_parse_iso_dt(snap_data.get("created_at"), fallback=now),
            )
        )
        db.flush()
        db.add_all(new_runs)

    AuditService(db).record(AuditAction.SYSTEM_BACKUP_RESTORED, owner_id)
    db.commit()

    return BackupRestoreOutput(
        project_id=new_project_id,
        name=raw_name,
        restored_sources=len(source_id_map),
        restored_datasets=len(dataset_id_map),
        restored_prompts=restored_prompt_versions,
        restored_experiments=len(exp_id_map),
        restored_snapshots=restored_snapshots,
    )


class BackupService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def export_project_backup(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        artifact_dir: str | Path | None = None,
    ) -> dict[str, Any]:
        return export_project_backup(self.db, owner_id, project_id, artifact_dir)

    def restore_project_backup(
        self,
        owner_id: uuid.UUID,
        bundle: dict[str, Any],
    ) -> BackupRestoreOutput:
        return restore_project_backup(self.db, owner_id, bundle)
