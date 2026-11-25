"""Provider adapter registry and public exports for LLM integrations."""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.infrastructure.llm.base import (
    PROVIDER_CATALOG,
    GenerationParameters,
    LLMRequest,
    LLMResponse,
    LLMUsage,
    ProviderAdapter,
    ProviderDescriptor,
    ProviderId,
    parse_provider_id,
    validate_model_id,
)
from app.infrastructure.llm.gemini import GeminiAdapter
from app.infrastructure.llm.groq import GroqAdapter
from app.infrastructure.llm.mock import MockLLMAdapter
from app.infrastructure.llm.openrouter import OpenRouterAdapter


class ProviderRegistry:
    """Resolves configured LLM provider adapters without exposing credentials."""

    def __init__(self, adapters: dict[ProviderId, ProviderAdapter]) -> None:
        self._adapters = dict(adapters)

    @classmethod
    def default(cls, settings: Settings | None = None) -> ProviderRegistry:
        cfg = settings or get_settings()
        return cls(
            {
                ProviderId.GROQ: GroqAdapter(base_url=cfg.groq_base_url),
                ProviderId.GEMINI: GeminiAdapter(base_url=cfg.gemini_base_url),
                ProviderId.OPENROUTER: OpenRouterAdapter(
                    base_url=cfg.openrouter_base_url,
                    app_url=cfg.public_app_url,
                ),
            }
        )

    def list_providers(self) -> list[ProviderId]:
        return list(self._adapters.keys())

    def get(self, provider: str | ProviderId) -> ProviderAdapter:
        pid = provider if isinstance(provider, ProviderId) else parse_provider_id(provider)
        return self._adapters[pid]


__all__ = [
    "PROVIDER_CATALOG",
    "GeminiAdapter",
    "GenerationParameters",
    "GroqAdapter",
    "LLMRequest",
    "LLMResponse",
    "LLMUsage",
    "MockLLMAdapter",
    "OpenRouterAdapter",
    "ProviderAdapter",
    "ProviderDescriptor",
    "ProviderId",
    "ProviderRegistry",
    "parse_provider_id",
    "validate_model_id",
]
