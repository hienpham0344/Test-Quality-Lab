from __future__ import annotations

import copy
import hashlib
import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm import GenerationParameters, ProviderId
from app.modules.ai_config.repository import AIConfigRepository
from app.modules.ai_config.service import AIConfigService
from app.modules.audit.service import AuditAction, AuditService
from app.modules.datasets.models import DatasetVersion
from app.modules.datasets.repository import DatasetRepository
from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.experiments.repository import ExperimentRepository
from app.modules.experiments.schemas import (
    ExperimentConfigInput,
    ExperimentCreateInput,
    ExperimentOutput,
    ExperimentPatchInput,
    ExperimentValidationOutput,
    SnapshotDetailOutput,
    SnapshotRunOutput,
    SnapshotSummaryOutput,
)
from app.modules.experiments.validation import (
    NormalizedExperimentConfig,
    extract_ast_function_map,
    normalize_experiment_config,
)
from app.modules.projects.repository import ProjectRepository
from app.modules.prompts.models import StrategyCode
from app.modules.prompts.renderer import SafePromptRenderer
from app.modules.prompts.service import PromptRegistryService
from app.modules.sources.models import SourceVersion
from app.modules.sources.repository import SourceRepository


def _canonical_sha256(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class ExperimentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ExperimentRepository(db)
        self.projects = ProjectRepository(db)
        self.sources = SourceRepository(db)
        self.datasets = DatasetRepository(db)
        self.ai_repo = AIConfigRepository(db)
        self.ai_service = AIConfigService(db)
        self.prompts = PromptRegistryService(db)
        self.audit = AuditService(db)

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def _resolve_inputs(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        raw_config: ExperimentConfigInput,
    ) -> tuple[
        NormalizedExperimentConfig,
        SourceVersion,
        DatasetVersion | None,
        list[dict[str, Any]] | None,
    ]:
        self._require_project(owner_id, project_id)
        if self.sources.source(owner_id, project_id, raw_config.source_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Python source not found")
        source_ver = self.sources.version(raw_config.source_id, raw_config.source_revision)
        if source_ver is None:
            raise AppError(ErrorCode.NOT_FOUND, "Python source revision not found")

        available_fns = {fn.name: fn.line for fn in source_ver.functions}
        normalized = normalize_experiment_config(raw_config, available_functions=available_fns)

        dataset_ver: DatasetVersion | None = None
        selected_row_dicts: list[dict[str, Any]] | None = None
        cfg = normalized.config

        if cfg.dataset_id is not None and cfg.dataset_revision is not None:
            if self.datasets.dataset(owner_id, project_id, cfg.dataset_id) is None:
                raise AppError(ErrorCode.NOT_FOUND, "CSV dataset not found")
            dataset_ver = self.datasets.version(cfg.dataset_id, cfg.dataset_revision)
            if dataset_ver is None:
                raise AppError(ErrorCode.NOT_FOUND, "CSV dataset revision not found")

            effective_rows = (
                cfg.selected_rows
                if cfg.selected_rows is not None
                else sorted(set(dataset_ver.selected_rows))
            )
            if not effective_rows:
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "Select at least one CSV row for dataset-backed experiment",
                    {"selected_rows": "At least one row must be selected"},
                )

            rows_by_num: dict[int, dict[str, Any]] = {
                int(row["row_number"]): row for row in dataset_ver.rows
            }
            chosen: list[dict[str, Any]] = []
            for row_num in effective_rows:
                row = rows_by_num.get(row_num)
                if row is None:
                    raise AppError(
                        ErrorCode.INPUT_INVALID,
                        f"CSV row {row_num} does not exist in dataset revision",
                        {"selected_rows": f"Unknown row {row_num}"},
                    )
                if row.get("status") != "valid":
                    raise AppError(
                        ErrorCode.CSV_ROW_INVALID,
                        f"CSV row {row_num} is not valid and cannot be selected",
                        {"selected_rows": f"Row {row_num} is not valid"},
                    )
                chosen.append(copy.deepcopy(row))

            selected_row_dicts = chosen
            cfg = cfg.model_copy(update={"selected_rows": effective_rows})
            normalized = NormalizedExperimentConfig(
                config=cfg,
                function_names=normalized.function_names,
                models=normalized.models,
                strategies=normalized.strategies,
                run_count=normalized.run_count,
            )

        return normalized, source_ver, dataset_ver, selected_row_dicts

    @staticmethod
    def _clean_metadata(name: str, description: str | None) -> tuple[str, str | None]:
        cleaned_name = name.strip()
        if not cleaned_name or len(cleaned_name) > 160:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Experiment name must contain 1 to 160 characters",
                {"name": "Must be 1..160 non-empty characters"},
            )
        return cleaned_name, description

    @staticmethod
    def _to_experiment_output(row: Experiment) -> ExperimentOutput:
        cfg = ExperimentConfigInput.model_validate(row.draft_config)
        run_count = len(cfg.function_names) * len(cfg.models) * len(cfg.strategies) * cfg.repeats
        return ExperimentOutput(
            id=row.id,
            project_id=row.project_id,
            name=row.name,
            description=row.description,
            config=cfg,
            run_count=run_count,
            latest_snapshot_number=row.latest_snapshot_number,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _to_snapshot_summary(snap: ExperimentSnapshot) -> SnapshotSummaryOutput:
        return SnapshotSummaryOutput(
            id=snap.id,
            experiment_id=snap.experiment_id,
            project_id=snap.project_id,
            snapshot_number=snap.snapshot_number,
            source_id=snap.source_id,
            source_revision=snap.source_revision,
            source_sha256=snap.source_sha256,
            dataset_id=snap.dataset_id,
            dataset_revision=snap.dataset_revision,
            dataset_sha256=snap.dataset_sha256,
            repeats=snap.repeats,
            run_count=snap.run_count,
            snapshot_sha256=snap.snapshot_sha256,
            created_at=snap.created_at,
        )

    @staticmethod
    def _to_snapshot_detail(
        snap: ExperimentSnapshot, runs: list[ExperimentSnapshotRun]
    ) -> SnapshotDetailOutput:
        return SnapshotDetailOutput(
            id=snap.id,
            experiment_id=snap.experiment_id,
            project_id=snap.project_id,
            snapshot_number=snap.snapshot_number,
            source_id=snap.source_id,
            source_revision=snap.source_revision,
            source_sha256=snap.source_sha256,
            dataset_id=snap.dataset_id,
            dataset_revision=snap.dataset_revision,
            dataset_sha256=snap.dataset_sha256,
            repeats=snap.repeats,
            run_count=snap.run_count,
            snapshot_sha256=snap.snapshot_sha256,
            created_at=snap.created_at,
            frozen_code=snap.frozen_code,
            frozen_functions=copy.deepcopy(snap.frozen_functions),
            frozen_rows=copy.deepcopy(snap.frozen_rows),
            frozen_selected_rows=list(snap.frozen_selected_rows)
            if snap.frozen_selected_rows is not None
            else None,
            frozen_models=copy.deepcopy(snap.frozen_models),
            frozen_parameters=GenerationParameters.model_validate(snap.frozen_parameters),
            frozen_prompts=copy.deepcopy(snap.frozen_prompts),
            runs=[
                SnapshotRunOutput(
                    id=r.id,
                    ordinal=r.ordinal,
                    function_name=r.function_name,
                    function_line=r.function_line,
                    provider=ProviderId(r.provider),
                    model=r.model,
                    strategy=StrategyCode(r.strategy),
                    prompt_version=r.prompt_version,
                    prompt_sha256=r.prompt_sha256,
                    rendered_prompt_sha256=r.rendered_prompt_sha256,
                    repeat_index=r.repeat_index,
                    run_hash=r.run_hash,
                )
                for r in runs
            ],
        )

    def validate_config(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        raw_config: ExperimentConfigInput,
    ) -> ExperimentValidationOutput:
        normalized, *_ = self._resolve_inputs(owner_id, project_id, raw_config)
        configured_providers = {
            ProviderId(item.provider) for item in self.ai_repo.list_by_project(project_id)
        }
        missing_creds: list[ProviderId] = []
        for target in normalized.models:
            if target.provider not in configured_providers and target.provider not in missing_creds:
                missing_creds.append(target.provider)

        summaries = {
            item.strategy: item for item in self.prompts.list_strategies(owner_id, project_id)
        }
        unapproved = [
            strat
            for strat in normalized.strategies
            if summaries[strat].approved_version is None
        ]
        return ExperimentValidationOutput(
            normalized_config=normalized.config,
            run_count=normalized.run_count,
            can_freeze=(not missing_creds and not unapproved),
            missing_credentials=missing_creds,
            unapproved_strategies=unapproved,
        )

    def create(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        payload: ExperimentCreateInput,
    ) -> ExperimentOutput:
        name, description = self._clean_metadata(payload.name, payload.description)
        normalized, *_ = self._resolve_inputs(owner_id, project_id, payload.config)
        now = utcnow()
        exp = Experiment(
            id=uuid.uuid4(),
            project_id=project_id,
            name=name,
            description=description,
            draft_config=normalized.config.model_dump(mode="json"),
            latest_snapshot_number=0,
            created_at=now,
            updated_at=now,
        )
        self.repo.add_experiment(exp)
        self.audit.record(AuditAction.EXPERIMENT_CREATED, owner_id)
        self.db.commit()
        self.db.refresh(exp)
        return self._to_experiment_output(exp)

    def list_experiments(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[ExperimentOutput]:
        self._require_project(owner_id, project_id)
        return [self._to_experiment_output(row) for row in self.repo.list_by_project(project_id)]

    def get_experiment(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, experiment_id: uuid.UUID
    ) -> ExperimentOutput:
        self._require_project(owner_id, project_id)
        exp = self.repo.get_experiment(project_id, experiment_id)
        if exp is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment not found")
        return self._to_experiment_output(exp)

    def patch_experiment(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        experiment_id: uuid.UUID,
        payload: ExperimentPatchInput,
    ) -> ExperimentOutput:
        self._require_project(owner_id, project_id)
        exp = self.repo.get_experiment(project_id, experiment_id)
        if exp is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment not found")

        changes = payload.model_dump(exclude_unset=True)
        new_name = payload.name if "name" in changes and payload.name is not None else exp.name
        new_desc = payload.description if "description" in changes else exp.description
        clean_name, clean_desc = self._clean_metadata(new_name, new_desc)

        if payload.config is not None:
            normalized, *_ = self._resolve_inputs(owner_id, project_id, payload.config)
            exp.draft_config = normalized.config.model_dump(mode="json")

        exp.name = clean_name
        exp.description = clean_desc
        exp.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(exp)
        return self._to_experiment_output(exp)

    def freeze_snapshot(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        experiment_id: uuid.UUID,
    ) -> SnapshotDetailOutput:
        self._require_project(owner_id, project_id)
        exp = self.repo.get_experiment(project_id, experiment_id)
        if exp is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment not found")

        raw_cfg = ExperimentConfigInput.model_validate(exp.draft_config)
        normalized, source_ver, dataset_ver, selected_row_dicts = self._resolve_inputs(
            owner_id, project_id, raw_cfg
        )

        # 1. Verify provider credentials exist and record masked provenance only.
        frozen_models: list[dict[str, Any]] = []
        for target in normalized.models:
            cred = self.ai_service.get_credential_metadata(owner_id, project_id, target.provider)
            frozen_models.append(
                {
                    "provider": target.provider.value,
                    "model": target.model,
                    "credential_key_id": cred.key_id,
                    "credential_key_hint": cred.key_hint,
                }
            )

        # 2. Verify all selected strategies have an APPROVED prompt version (blocks UNAPPROVED).
        frozen_prompts: dict[str, dict[str, Any]] = {}
        approved_by_strategy = {}
        for strat in normalized.strategies:
            pv = self.prompts.require_approved_version(owner_id, project_id, strat)
            approved_by_strategy[strat] = pv
            frozen_prompts[strat.value] = {
                "template_id": str(pv.template_id),
                "version": pv.version,
                "sha256": pv.sha256,
                "system_template": pv.system_template,
                "user_template": pv.user_template,
                "required_variables": list(pv.required_variables),
            }

        # 3. Extract static AST function details and render deterministic prompt hashes.
        fn_map = extract_ast_function_map(source_ver.code)
        frozen_functions: list[dict[str, Any]] = []
        rendered_hash_by_pair: dict[tuple[str, StrategyCode], str] = {}

        for fn_name in normalized.function_names:
            extracted = fn_map.get(fn_name)
            if extracted is None:
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    f"Function '{fn_name}' could not be extracted from source AST",
                    {"function_names": f"Missing AST definition for '{fn_name}'"},
                )
            frozen_functions.append(
                {
                    "name": extracted.name,
                    "line": extracted.line,
                    "signature": extracted.signature,
                    "docstring": extracted.docstring,
                    "code": extracted.code,
                }
            )
            matching_cases = (
                [r for r in selected_row_dicts if r.get("function_name") == fn_name]
                if selected_row_dicts is not None
                else []
            )
            render_ctx = {
                "function_name": extracted.name,
                "function_signature": extracted.signature,
                "function_code": extracted.code,
                "module_code": source_ver.code,
                "docstring": extracted.docstring,
                "csv_cases": json.dumps(
                    matching_cases, sort_keys=True, separators=(",", ":"), ensure_ascii=False
                ),
            }
            for strat in normalized.strategies:
                pv = approved_by_strategy[strat]
                rendered = SafePromptRenderer.render(
                    strategy=pv.strategy,
                    version=pv.version,
                    template_sha256=pv.sha256,
                    system_template=pv.system_template,
                    user_template=pv.user_template,
                    required_variables=list(pv.required_variables),
                    context=render_ctx,
                )
                rendered_hash_by_pair[(fn_name, strat)] = rendered.rendered_sha256

        # 4. Materialize deterministic planned run matrix.
        frozen_params = normalized.config.parameters.model_dump(mode="json")
        snapshot_id = uuid.uuid4()
        next_number = exp.latest_snapshot_number + 1
        runs: list[ExperimentSnapshotRun] = []
        ordinal = 0

        for fn_name in normalized.function_names:
            fn_line = fn_map[fn_name].line
            for target in normalized.models:
                for strat in normalized.strategies:
                    pv = approved_by_strategy[strat]
                    rendered_sha = rendered_hash_by_pair[(fn_name, strat)]
                    for repeat_idx in range(1, normalized.config.repeats + 1):
                        ordinal += 1
                        run_hash = _canonical_sha256(
                            {
                                "source_sha256": source_ver.sha256,
                                "dataset_sha256": dataset_ver.sha256 if dataset_ver else None,
                                "function_name": fn_name,
                                "function_line": fn_line,
                                "provider": target.provider.value,
                                "model": target.model,
                                "strategy": strat.value,
                                "prompt_version": pv.version,
                                "prompt_sha256": pv.sha256,
                                "rendered_prompt_sha256": rendered_sha,
                                "parameters": frozen_params,
                                "repeat_index": repeat_idx,
                            }
                        )
                        runs.append(
                            ExperimentSnapshotRun(
                                id=uuid.uuid4(),
                                snapshot_id=snapshot_id,
                                ordinal=ordinal,
                                function_name=fn_name,
                                function_line=fn_line,
                                provider=target.provider.value,
                                model=target.model,
                                strategy=strat.value,
                                prompt_version=pv.version,
                                prompt_sha256=pv.sha256,
                                rendered_prompt_sha256=rendered_sha,
                                repeat_index=repeat_idx,
                                run_hash=run_hash,
                            )
                        )

        frozen_selected_rows = (
            list(normalized.config.selected_rows)
            if normalized.config.selected_rows is not None
            else None
        )
        snapshot_sha = _canonical_sha256(
            {
                "source_id": str(source_ver.source_id),
                "source_revision": source_ver.revision,
                "source_sha256": source_ver.sha256,
                "frozen_code": source_ver.code,
                "frozen_functions": frozen_functions,
                "dataset_id": str(dataset_ver.dataset_id) if dataset_ver else None,
                "dataset_revision": dataset_ver.revision if dataset_ver else None,
                "dataset_sha256": dataset_ver.sha256 if dataset_ver else None,
                "frozen_rows": selected_row_dicts,
                "frozen_selected_rows": frozen_selected_rows,
                "frozen_models": frozen_models,
                "frozen_parameters": frozen_params,
                "frozen_prompts": frozen_prompts,
                "repeats": normalized.config.repeats,
                "run_hashes": [r.run_hash for r in runs],
            }
        )

        now = utcnow()
        exp.latest_snapshot_number = next_number
        exp.updated_at = now
        snapshot = ExperimentSnapshot(
            id=snapshot_id,
            experiment_id=exp.id,
            project_id=project_id,
            snapshot_number=next_number,
            source_id=source_ver.source_id,
            source_revision=source_ver.revision,
            source_sha256=source_ver.sha256,
            frozen_code=source_ver.code,
            frozen_functions=frozen_functions,
            dataset_id=dataset_ver.dataset_id if dataset_ver else None,
            dataset_revision=dataset_ver.revision if dataset_ver else None,
            dataset_sha256=dataset_ver.sha256 if dataset_ver else None,
            frozen_rows=selected_row_dicts,
            frozen_selected_rows=frozen_selected_rows,
            frozen_models=frozen_models,
            frozen_parameters=frozen_params,
            frozen_prompts=frozen_prompts,
            repeats=normalized.config.repeats,
            run_count=len(runs),
            snapshot_sha256=snapshot_sha,
            created_at=now,
        )
        self.repo.add_snapshot(snapshot)
        self.db.flush()
        self.repo.add_snapshot_runs(runs)
        self.audit.record(AuditAction.EXPERIMENT_SNAPSHOT_FROZEN, owner_id)
        self.db.commit()
        return self._to_snapshot_detail(snapshot, runs)

    def list_snapshots(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, experiment_id: uuid.UUID
    ) -> list[SnapshotSummaryOutput]:
        self._require_project(owner_id, project_id)
        exp = self.repo.get_experiment(project_id, experiment_id)
        if exp is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment not found")
        return [self._to_snapshot_summary(s) for s in self.repo.list_snapshots(exp.id)]

    def get_snapshot(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        experiment_id: uuid.UUID,
        snapshot_id: uuid.UUID,
    ) -> SnapshotDetailOutput:
        self._require_project(owner_id, project_id)
        exp = self.repo.get_experiment(project_id, experiment_id)
        if exp is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment not found")
        snap = self.repo.get_snapshot(exp.id, snapshot_id)
        if snap is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment snapshot not found")
        runs = self.repo.list_runs(snap.id)
        return self._to_snapshot_detail(snap, runs)
