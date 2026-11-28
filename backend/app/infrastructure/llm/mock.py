"""Programmable deterministic LLM provider adapter for offline queue, retry, and cancel QA."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
from pydantic import SecretStr

from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets
from app.core.security import mask_secret
from app.infrastructure.llm.base import (
    GenerationParameters,
    LLMRequest,
    LLMResponse,
    LLMUsage,
    ProviderHTTPError,
    ProviderId,
    require_non_empty_secret,
    validate_model_id,
)

if TYPE_CHECKING:
    from app.infrastructure.llm import ProviderRegistry


@dataclass(frozen=True)
class MockSuccess:
    content: str = "def test_generated_case():\n    assert 1 + 1 == 2\n"
    prompt_tokens: int = 40
    completion_tokens: int = 24
    latency_ms: int = 12
    finish_reason: str = "stop"
    on_call: Callable[[LLMRequest, int], None] | None = None


@dataclass(frozen=True)
class MockHTTPError:
    status_code: int
    body: str = "Upstream provider failure"
    reflect_api_key: bool = False
    retry_after: float | None = None


@dataclass(frozen=True)
class MockTimeout:
    message: str = "Upstream provider request timed out"


MockOutcome = MockSuccess | MockHTTPError | MockTimeout
MockStepFactory = Callable[[LLMRequest, SecretStr, int], MockOutcome]


@dataclass(frozen=True)
class MockRecordedCall:
    call_index: int
    model: str
    user_prompt: str
    system_prompt: str | None
    parameters: GenerationParameters
    key_hint: str


class MockLLMAdapter:
    """Deterministic programmable ``ProviderAdapter`` that never makes network calls."""

    def __init__(
        self,
        provider_id: ProviderId = ProviderId.GROQ,
        steps: Sequence[MockOutcome | MockStepFactory] = (),
    ) -> None:
        self._provider_id = provider_id
        self._steps: list[MockOutcome | MockStepFactory] = list(steps)
        self.calls: list[MockRecordedCall] = []

    @property
    def provider_id(self) -> ProviderId:
        return self._provider_id

    @staticmethod
    def build_registry(*adapters: MockLLMAdapter) -> ProviderRegistry:
        from app.infrastructure.llm import ProviderRegistry

        by_provider = {adapter.provider_id: adapter for adapter in adapters}
        for pid in ProviderId:
            by_provider.setdefault(pid, MockLLMAdapter(pid))
        return ProviderRegistry(by_provider)  # type: ignore[arg-type]

    def generate(self, request: LLMRequest, api_key: SecretStr) -> LLMResponse:
        model = validate_model_id(request.model)
        raw_secret = require_non_empty_secret(api_key)
        call_idx = len(self.calls) + 1
        self.calls.append(
            MockRecordedCall(
                call_index=call_idx,
                model=model,
                user_prompt=request.user_prompt,
                system_prompt=request.system_prompt,
                parameters=request.parameters,
                key_hint=mask_secret(raw_secret),
            )
        )

        step: MockOutcome | MockStepFactory
        if call_idx <= len(self._steps):
            step = self._steps[call_idx - 1]
        else:
            step = MockSuccess()

        outcome = step(request, api_key, call_idx) if callable(step) else step

        if isinstance(outcome, MockTimeout):
            raw_timeout = httpx.ReadTimeout(outcome.message)
            safe_reason = redact_secrets(str(raw_timeout), extra_secrets=[raw_secret])
            raise AppError(
                ErrorCode.PROVIDER_UPSTREAM_ERROR,
                f"{self._provider_id.value} request failed: {safe_reason}",
            ) from raw_timeout

        if isinstance(outcome, MockHTTPError):
            raw_body = (
                f"{outcome.body} {raw_secret}".strip() if outcome.reflect_api_key else outcome.body
            )
            safe_body = redact_secrets(raw_body[:500], extra_secrets=[raw_secret])
            raise ProviderHTTPError(
                f"{self._provider_id.value} returned HTTP {outcome.status_code}: {safe_body}",
                status_code=outcome.status_code,
                retry_after=outcome.retry_after,
            )

        if outcome.on_call is not None:
            outcome.on_call(request, call_idx)

        total_tok = outcome.prompt_tokens + outcome.completion_tokens
        return LLMResponse(
            provider=self._provider_id,
            model=model,
            content=outcome.content,
            finish_reason=outcome.finish_reason,
            usage=LLMUsage(
                prompt_tokens=outcome.prompt_tokens,
                completion_tokens=outcome.completion_tokens,
                total_tokens=total_tok,
            ),
            latency_ms=outcome.latency_ms,
        )
