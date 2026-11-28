"""Unified LLM provider contracts, validation, and sanitized transport helpers."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$")


class ProviderId(StrEnum):
    GROQ = "groq"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"


@dataclass(frozen=True)
class ProviderDescriptor:
    id: ProviderId
    label: str
    auth_scheme: str


PROVIDER_CATALOG: tuple[ProviderDescriptor, ...] = (
    ProviderDescriptor(ProviderId.GROQ, "Groq", "Bearer header"),
    ProviderDescriptor(ProviderId.GEMINI, "Google Gemini", "x-goog-api-key header"),
    ProviderDescriptor(ProviderId.OPENROUTER, "OpenRouter", "Bearer header"),
)


def parse_provider_id(raw: str) -> ProviderId:
    normalized = raw.strip().lower()
    try:
        return ProviderId(normalized)
    except ValueError as exc:
        raise AppError(
            ErrorCode.PROVIDER_UNSUPPORTED,
            f"Unsupported AI provider: {raw!r}",
            {"provider": "Must be one of: groq, gemini, openrouter"},
        ) from exc


def validate_model_id(raw: str) -> str:
    candidate = raw.strip()
    if (
        not candidate
        or len(candidate) > 120
        or ".." in candidate
        or not _MODEL_ID_RE.match(candidate)
    ):
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Invalid model identifier",
            {"model": "Must be 1..120 safe characters without spaces or path traversal"},
        )
    return candidate


def require_non_empty_secret(api_key: SecretStr) -> str:
    raw = api_key.get_secret_value().strip()
    if not raw:
        raise AppError(
            ErrorCode.CREDENTIAL_MISSING,
            "API key cannot be empty",
            {"api_key": "Required"},
        )
    return raw


def strict_int(value: Any) -> int | None:
    return value if type(value) is int else None


class GenerationParameters(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=16384)
    top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    timeout_seconds: float = Field(default=30.0, gt=0.0, le=120.0)


@dataclass(frozen=True)
class LLMRequest:
    model: str
    user_prompt: str
    system_prompt: str | None = None
    parameters: GenerationParameters = field(default_factory=GenerationParameters)


@dataclass(frozen=True)
class LLMUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True)
class LLMResponse:
    provider: ProviderId
    model: str
    content: str
    finish_reason: str | None
    usage: LLMUsage
    latency_ms: int


class ProviderHTTPError(AppError):
    """Provider answered with an HTTP error. Keeps the status and Retry-After for classification (FR-AIC-004)."""

    def __init__(self, message: str, *, status_code: int, retry_after: float | None = None) -> None:
        super().__init__(ErrorCode.PROVIDER_UPSTREAM_ERROR, message)
        self.status_code = status_code
        self.retry_after = retry_after


def parse_retry_after(raw: str | None) -> float | None:
    """Seconds from a `Retry-After` header (delta-seconds form only); None when absent or invalid."""
    if raw is None:
        return None
    try:
        seconds = float(raw.strip())
    except ValueError:
        return None
    return seconds if 0 <= seconds <= 86_400 else None


class ProviderAdapter(Protocol):
    @property
    def provider_id(self) -> ProviderId: ...

    def generate(self, request: LLMRequest, api_key: SecretStr) -> LLMResponse: ...


def execute_json_post(
    *,
    provider: ProviderId,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout_seconds: float,
    raw_secret: str,
    client: httpx.Client | None = None,
) -> tuple[dict[str, Any], int]:
    """Perform a JSON POST with secret-scrubbed error handling."""
    started = time.perf_counter()
    owns_client = client is None
    active_client = client or httpx.Client(timeout=timeout_seconds)
    try:
        response = active_client.post(url, headers=headers, json=payload, timeout=timeout_seconds)
    except httpx.HTTPError as exc:
        safe_reason = redact_secrets(str(exc), extra_secrets=[raw_secret])
        raise AppError(
            ErrorCode.PROVIDER_UPSTREAM_ERROR,
            f"{provider.value} request failed: {safe_reason}",
        ) from exc
    finally:
        if owns_client:
            active_client.close()

    latency_ms = max(0, int((time.perf_counter() - started) * 1000))
    if response.status_code >= 400:
        safe_body = redact_secrets(response.text[:500], extra_secrets=[raw_secret])
        raise ProviderHTTPError(
            f"{provider.value} returned HTTP {response.status_code}: {safe_body}",
            status_code=response.status_code,
            retry_after=parse_retry_after(response.headers.get("Retry-After")),
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise AppError(
            ErrorCode.PROVIDER_UPSTREAM_ERROR,
            f"{provider.value} returned malformed JSON response",
        ) from exc
    if not isinstance(data, dict):
        raise AppError(
            ErrorCode.PROVIDER_UPSTREAM_ERROR,
            f"{provider.value} returned unexpected JSON shape",
        )
    return data, latency_ms


def parse_openai_chat_response(
    provider: ProviderId,
    fallback_model: str,
    data: dict[str, Any],
    latency_ms: int,
) -> LLMResponse:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise AppError(
            ErrorCode.PROVIDER_UPSTREAM_ERROR,
            f"{provider.value} response contained no choices",
        )
    first: dict[str, Any] = choices[0] if isinstance(choices[0], dict) else {}
    raw_msg = first.get("message")
    message: dict[str, Any] = raw_msg if isinstance(raw_msg, dict) else {}
    content = message.get("content")
    if not isinstance(content, str):
        raise AppError(
            ErrorCode.PROVIDER_UPSTREAM_ERROR,
            f"{provider.value} response message lacked text content",
        )
    raw_usage = data.get("usage")
    usage_raw: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
    prompt_tok = usage_raw.get("prompt_tokens")
    comp_tok = usage_raw.get("completion_tokens")
    total_tok = usage_raw.get("total_tokens")
    usage = LLMUsage(
        prompt_tokens=strict_int(prompt_tok),
        completion_tokens=strict_int(comp_tok),
        total_tokens=strict_int(total_tok),
    )
    raw_finish = first.get("finish_reason")
    finish_reason = raw_finish if isinstance(raw_finish, str) else None
    raw_model = data.get("model")
    model_name = raw_model if isinstance(raw_model, str) else fallback_model
    return LLMResponse(
        provider=provider,
        model=model_name,
        content=content,
        finish_reason=finish_reason,
        usage=usage,
        latency_ms=latency_ms,
    )
