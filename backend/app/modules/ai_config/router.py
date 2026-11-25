from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.security import CredentialVault
from app.infrastructure.database.session import get_db
from app.modules.ai_config.dependencies import get_vault
from app.modules.ai_config.schemas import (
    ProviderCatalogEntry,
    ProviderCredentialInput,
    ProviderCredentialOutput,
)
from app.modules.ai_config.service import AIConfigService
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User

router = APIRouter(prefix="/projects/{project_id}/ai-configs", tags=["ai-configs"])


@router.get("/providers", response_model=list[ProviderCatalogEntry])
def list_providers(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[ProviderCatalogEntry]:
    return AIConfigService(db).list_catalog(user.id, project_id)


@router.get("", response_model=list[ProviderCredentialOutput])
def list_configured_providers(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> list[ProviderCredentialOutput]:
    return AIConfigService(db, vault).list_configured(user.id, project_id)


@router.put("/{provider}", response_model=ProviderCredentialOutput)
def save_provider_credential(
    project_id: uuid.UUID,
    provider: str,
    payload: ProviderCredentialInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> ProviderCredentialOutput:
    return AIConfigService(db, vault).upsert_credential(user.id, project_id, provider, payload)


@router.post("/{provider}/rotate-encryption", response_model=ProviderCredentialOutput)
def rotate_provider_credential_encryption(
    project_id: uuid.UUID,
    provider: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> ProviderCredentialOutput:
    return AIConfigService(db, vault).rotate_encryption(user.id, project_id, provider)


@router.delete("/{provider}", status_code=204)
def delete_provider_credential(
    project_id: uuid.UUID,
    provider: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Response:
    AIConfigService(db).delete_credential(user.id, project_id, provider)
    return Response(status_code=204)
