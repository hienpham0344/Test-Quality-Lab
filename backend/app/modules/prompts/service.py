from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.modules.audit.service import AuditAction, AuditService
from app.modules.projects.repository import ProjectRepository
from app.modules.prompts.models import (
    DEFAULT_STRATEGY_TITLES,
    PromptStatus,
    PromptTemplate,
    PromptVersion,
    StrategyCode,
)
from app.modules.prompts.renderer import (
    RenderedPrompt,
    SafePromptRenderer,
    compute_template_sha256,
    extract_template_variables,
    normalize_newlines,
)
from app.modules.prompts.repository import PromptRepository
from app.modules.prompts.schemas import (
    PromptRenderOutput,
    PromptTemplateSummary,
    PromptVersionInput,
    PromptVersionOutput,
)


def parse_strategy_code(raw: str | StrategyCode) -> StrategyCode:
    if isinstance(raw, StrategyCode):
        return raw
    try:
        return StrategyCode(raw.strip().upper())
    except ValueError as exc:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            f"Unsupported prompt strategy: {raw!r}",
            {"strategy": "Must be one of L1, L2, L3, L4, L5"},
        ) from exc


class PromptRegistryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = PromptRepository(db)
        self.projects = ProjectRepository(db)
        self.audit = AuditService(db)

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def ensure_default_strategies(self, project_id: uuid.UUID) -> list[PromptTemplate]:
        """Bootstrap L1-L5 slots in UNAPPROVED state (SRS TBD-04: no invented prompt text)."""
        existing = {row.strategy: row for row in self.repo.list_templates(project_id)}
        now = utcnow()
        created = False
        for code in StrategyCode:
            if code.value not in existing:
                row = PromptTemplate(
                    id=uuid.uuid4(),
                    project_id=project_id,
                    strategy=code.value,
                    title=DEFAULT_STRATEGY_TITLES[code],
                    current_version=0,
                    approved_version=None,
                    created_at=now,
                    updated_at=now,
                )
                self.repo.add_template(row)
                created = True
        if created:
            self.db.commit()
        return self.repo.list_templates(project_id)

    @staticmethod
    def _to_summary(row: PromptTemplate) -> PromptTemplateSummary:
        status = (
            PromptStatus.APPROVED if row.approved_version is not None else PromptStatus.UNAPPROVED
        )
        return PromptTemplateSummary(
            id=row.id,
            strategy=StrategyCode(row.strategy),
            title=row.title,
            current_version=row.current_version,
            approved_version=row.approved_version,
            status=status,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _to_version_output(row: PromptVersion) -> PromptVersionOutput:
        return PromptVersionOutput(
            id=row.id,
            template_id=row.template_id,
            strategy=StrategyCode(row.strategy),
            version=row.version,
            status=PromptStatus(row.status),
            system_template=row.system_template,
            user_template=row.user_template,
            required_variables=list(row.required_variables),
            sha256=row.sha256,
            notes=row.notes,
            approved_at=row.approved_at,
            created_at=row.created_at,
        )

    def list_strategies(
        self, owner_id: uuid.UUID, project_id: uuid.UUID
    ) -> list[PromptTemplateSummary]:
        self._require_project(owner_id, project_id)
        return [self._to_summary(row) for row in self.ensure_default_strategies(project_id)]

    def list_versions(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, strategy_raw: str | StrategyCode
    ) -> list[PromptVersionOutput]:
        self._require_project(owner_id, project_id)
        code = parse_strategy_code(strategy_raw)
        self.ensure_default_strategies(project_id)
        template = self.repo.get_template_by_strategy(project_id, code.value)
        if template is None:
            raise AppError(ErrorCode.NOT_FOUND, "Prompt template not found")
        return [self._to_version_output(v) for v in self.repo.list_versions(template.id)]

    def create_version(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        strategy_raw: str | StrategyCode,
        payload: PromptVersionInput,
    ) -> PromptVersionOutput:
        self._require_project(owner_id, project_id)
        code = parse_strategy_code(strategy_raw)
        self.ensure_default_strategies(project_id)
        template = self.repo.get_template_by_strategy(project_id, code.value)
        if template is None:
            raise AppError(ErrorCode.NOT_FOUND, "Prompt template not found")

        norm_user = normalize_newlines(payload.user_template)
        norm_sys = (
            normalize_newlines(payload.system_template)
            if payload.system_template is not None and payload.system_template.strip()
            else None
        )
        required_vars = extract_template_variables(norm_sys, norm_user)
        digest = compute_template_sha256(code.value, norm_sys, norm_user)

        now = utcnow()
        next_version = template.current_version + 1
        template.current_version = next_version
        template.updated_at = now

        version_row = PromptVersion(
            id=uuid.uuid4(),
            template_id=template.id,
            strategy=code.value,
            version=next_version,
            status=PromptStatus.UNAPPROVED.value,
            system_template=norm_sys,
            user_template=norm_user,
            required_variables=required_vars,
            sha256=digest,
            notes=payload.notes,
            created_by=owner_id,
            approved_at=None,
            created_at=now,
        )
        self.repo.add_version(version_row)
        self.audit.record(AuditAction.PROMPT_VERSION_CREATED, owner_id)
        self.db.commit()
        self.db.refresh(version_row)
        return self._to_version_output(version_row)

    def approve_version(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        strategy_raw: str | StrategyCode,
        version: int,
    ) -> PromptVersionOutput:
        self._require_project(owner_id, project_id)
        code = parse_strategy_code(strategy_raw)
        self.ensure_default_strategies(project_id)
        template = self.repo.get_template_by_strategy(project_id, code.value)
        if template is None:
            raise AppError(ErrorCode.NOT_FOUND, "Prompt template not found")

        target = self.repo.get_version(template.id, version)
        if target is None:
            raise AppError(
                ErrorCode.NOT_FOUND, f"Prompt version {version} not found for {code.value}"
            )

        now = utcnow()
        current_approved = self.repo.get_approved_version(template.id)
        if current_approved is not None and current_approved.id != target.id:
            current_approved.status = PromptStatus.DEPRECATED.value

        target.status = PromptStatus.APPROVED.value
        target.approved_at = now
        template.approved_version = target.version
        template.updated_at = now

        self.audit.record(AuditAction.PROMPT_VERSION_APPROVED, owner_id)
        self.db.commit()
        self.db.refresh(target)
        return self._to_version_output(target)

    def require_approved_version(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, strategy_raw: str | StrategyCode
    ) -> PromptVersion:
        self._require_project(owner_id, project_id)
        code = parse_strategy_code(strategy_raw)
        self.ensure_default_strategies(project_id)
        template = self.repo.get_template_by_strategy(project_id, code.value)
        if template is None:
            raise AppError(ErrorCode.NOT_FOUND, "Prompt template not found")
        approved = self.repo.get_approved_version(template.id)
        if approved is None:
            raise AppError(
                ErrorCode.PROMPT_NOT_APPROVED,
                f"Prompt strategy {code.value} has no approved version (SRS TBD-04)",
                {"strategy": code.value},
            )
        return approved

    def render_approved_domain(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        strategy_raw: str | StrategyCode,
        context: dict[str, str],
    ) -> RenderedPrompt:
        approved = self.require_approved_version(owner_id, project_id, strategy_raw)
        return SafePromptRenderer.render(
            strategy=approved.strategy,
            version=approved.version,
            template_sha256=approved.sha256,
            system_template=approved.system_template,
            user_template=approved.user_template,
            required_variables=list(approved.required_variables),
            context=context,
        )

    def render_approved(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        strategy_raw: str | StrategyCode,
        context: dict[str, str],
    ) -> PromptRenderOutput:
        rendered = self.render_approved_domain(owner_id, project_id, strategy_raw, context)
        return PromptRenderOutput(
            strategy=StrategyCode(rendered.strategy),
            version=rendered.version,
            template_sha256=rendered.template_sha256,
            rendered_system=rendered.rendered_system,
            rendered_user=rendered.rendered_user,
            rendered_sha256=rendered.rendered_sha256,
        )
