from __future__ import annotations

import uuid

from pydantic import SecretStr
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.core.security import CredentialVault, mask_secret
from app.infrastructure.llm import (
    PROVIDER_CATALOG,
    GenerationParameters,
    ProviderId,
    parse_provider_id,
    validate_model_id,
)
from app.modules.ai_config.models import ProviderCredential
from app.modules.ai_config.repository import AIConfigRepository
from app.modules.ai_config.schemas import (
    ProviderCatalogEntry,
    ProviderCredentialInput,
    ProviderCredentialOutput,
)
from app.modules.audit.service import AuditAction, AuditService
from app.modules.projects.repository import ProjectRepository


class AIConfigService:
    def __init__(self, db: Session, vault: CredentialVault | None = None) -> None:
        self.db = db
        self.vault = vault
        self.repo = AIConfigRepository(db)
        self.projects = ProjectRepository(db)
        self.audit = AuditService(db)

    @staticmethod
    def _aad(project_id: uuid.UUID, provider: ProviderId) -> str:
        return f"{project_id}:{provider.value}"

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def _require_vault(self) -> CredentialVault:
        if self.vault is None:
            raise AppError(
                ErrorCode.SERVICE_UNAVAILABLE,
                "Credential encryption key is not configured",
            )
        return self.vault

    def _to_output(
        self, record: ProviderCredential, vault: CredentialVault
    ) -> ProviderCredentialOutput:
        return ProviderCredentialOutput(
            id=record.id,
            project_id=record.project_id,
            provider=ProviderId(record.provider),
            default_model=record.default_model,
            key_id=record.key_id,
            key_hint=record.key_hint,
            needs_rotation=vault.needs_rotation(record.encrypted_secret),
            default_params=GenerationParameters.model_validate(record.default_params),
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def list_catalog(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[ProviderCatalogEntry]:
        self._require_project(owner_id, project_id)
        return [
            ProviderCatalogEntry(id=item.id, label=item.label, auth_scheme=item.auth_scheme)
            for item in PROVIDER_CATALOG
        ]

    def list_configured(
        self, owner_id: uuid.UUID, project_id: uuid.UUID
    ) -> list[ProviderCredentialOutput]:
        self._require_project(owner_id, project_id)
        vault = self._require_vault()
        return [self._to_output(row, vault) for row in self.repo.list_by_project(project_id)]

    def upsert_credential(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        provider_raw: str,
        payload: ProviderCredentialInput,
    ) -> ProviderCredentialOutput:
        self._require_project(owner_id, project_id)
        provider = parse_provider_id(provider_raw)
        model = validate_model_id(payload.default_model)
        if provider == ProviderId.GEMINI and ("/" in model or ":" in model):
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid Gemini model identifier",
                {"default_model": "Use model slug without slashes or colons"},
            )
        raw_secret = payload.api_key.get_secret_value().strip()
        if len(raw_secret) < 8:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "API key is too short",
                {"api_key": "Must contain at least 8 non-whitespace characters"},
            )

        vault = self._require_vault()
        key_id, encrypted = vault.encrypt(raw_secret, aad=self._aad(project_id, provider))
        hint = mask_secret(raw_secret)
        now = utcnow()

        existing = self.repo.get_by_provider(project_id, provider.value)
        if existing is None:
            record = ProviderCredential(
                id=uuid.uuid4(),
                project_id=project_id,
                provider=provider.value,
                default_model=model,
                key_id=key_id,
                encrypted_secret=encrypted,
                key_hint=hint,
                default_params=payload.default_params.model_dump(),
                created_at=now,
                updated_at=now,
            )
            self.repo.add(record)
        else:
            existing.default_model = model
            existing.key_id = key_id
            existing.encrypted_secret = encrypted
            existing.key_hint = hint
            existing.default_params = payload.default_params.model_dump()
            existing.updated_at = now
            record = existing

        self.audit.record(AuditAction.AI_CREDENTIAL_SAVED, owner_id)
        self.db.commit()
        self.db.refresh(record)
        return self._to_output(record, vault)

    def rotate_encryption(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, provider_raw: str
    ) -> ProviderCredentialOutput:
        self._require_project(owner_id, project_id)
        provider = parse_provider_id(provider_raw)
        vault = self._require_vault()
        record = self.repo.get_by_provider(project_id, provider.value)
        if record is None:
            raise AppError(ErrorCode.NOT_FOUND, "Provider credential not found")

        new_key_id, rewrapped = vault.rotate(
            record.encrypted_secret, aad=self._aad(project_id, provider)
        )
        record.key_id = new_key_id
        record.encrypted_secret = rewrapped
        record.updated_at = utcnow()
        self.audit.record(AuditAction.AI_CREDENTIAL_ROTATED, owner_id)
        self.db.commit()
        self.db.refresh(record)
        return self._to_output(record, vault)

    def delete_credential(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, provider_raw: str
    ) -> None:
        self._require_project(owner_id, project_id)
        provider = parse_provider_id(provider_raw)
        record = self.repo.get_by_provider(project_id, provider.value)
        if record is None:
            raise AppError(ErrorCode.NOT_FOUND, "Provider credential not found")
        self.repo.delete(record)
        self.audit.record(AuditAction.AI_CREDENTIAL_DELETED, owner_id)
        self.db.commit()

    def get_credential_metadata(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, provider_raw: str | ProviderId
    ) -> ProviderCredential:
        self._require_project(owner_id, project_id)
        provider = (
            provider_raw if isinstance(provider_raw, ProviderId) else parse_provider_id(provider_raw)
        )
        record = self.repo.get_by_provider(project_id, provider.value)
        if record is None:
            raise AppError(
                ErrorCode.CREDENTIAL_MISSING,
                f"No encrypted API key configured for provider '{provider.value}'",
                {"provider": provider.value},
            )
        return record

    def resolve_api_key(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, provider_raw: str | ProviderId
    ) -> SecretStr:
        record = self.get_credential_metadata(owner_id, project_id, provider_raw)
        provider = ProviderId(record.provider)
        vault = self._require_vault()
        return vault.decrypt(record.encrypted_secret, aad=self._aad(project_id, provider))
