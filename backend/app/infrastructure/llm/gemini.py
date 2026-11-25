"""Google Gemini generateContent adapter (header-authenticated, zero URL secrets)."""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import SecretStr

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm.base import (
    LLMRequest,
    LLMResponse,
    LLMUsage,
    ProviderId,
    execute_json_post,
    require_non_empty_secret,
    strict_int,
    validate_model_id,
)


class GeminiAdapter:
    def __init__(
        self,
        *,
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client

    @property
    def provider_id(self) -> ProviderId:
        return ProviderId.GEMINI

    def generate(self, request: LLMRequest, api_key: SecretStr) -> LLMResponse:
        model = validate_model_id(request.model)
        if "/" in model or ":" in model:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid Gemini model identifier",
                {"model": "Provide the model slug without slashes or colons (e.g. gemini-2.5-flash)"},
            )
        raw_secret = require_non_empty_secret(api_key)
        gen_config: dict[str, Any] = {
            "temperature": request.parameters.temperature,
            "maxOutputTokens": request.parameters.max_tokens,
            "topP": request.parameters.top_p,
        }
        if request.parameters.seed is not None:
            gen_config["seed"] = request.parameters.seed

        payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": request.user_prompt}]}],
            "generationConfig": gen_config,
        }
        if request.system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": request.system_prompt}]}

        data, latency_ms = execute_json_post(
            provider=ProviderId.GEMINI,
            url=f"{self._base_url}/models/{model}:generateContent",
            headers={
                "x-goog-api-key": raw_secret,
                "Content-Type": "application/json",
            },
            payload=payload,
            timeout_seconds=request.parameters.timeout_seconds,
            raw_secret=raw_secret,
            client=self._client,
        )

        candidates = data.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise AppError(
                ErrorCode.PROVIDER_UPSTREAM_ERROR,
                "gemini response contained no candidates",
            )
        first: dict[str, Any] = candidates[0] if isinstance(candidates[0], dict) else {}
        raw_content = first.get("content")
        content_obj: dict[str, Any] = raw_content if isinstance(raw_content, dict) else {}
        raw_parts = content_obj.get("parts")
        parts: list[Any] = raw_parts if isinstance(raw_parts, list) else []
        texts = [p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
        if not texts:
            raise AppError(
                ErrorCode.PROVIDER_UPSTREAM_ERROR,
                "gemini candidate contained no text parts",
            )

        raw_usage = data.get("usageMetadata")
        usage_meta: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
        prompt_tok = usage_meta.get("promptTokenCount")
        comp_tok = usage_meta.get("candidatesTokenCount")
        total_tok = usage_meta.get("totalTokenCount")
        usage = LLMUsage(
            prompt_tokens=strict_int(prompt_tok),
            completion_tokens=strict_int(comp_tok),
            total_tokens=strict_int(total_tok),
        )
        raw_finish = first.get("finishReason")
        finish_reason = raw_finish if isinstance(raw_finish, str) else None
        return LLMResponse(
            provider=ProviderId.GEMINI,
            model=model,
            content="".join(texts),
            finish_reason=finish_reason,
            usage=usage,
            latency_ms=latency_ms,
        )
