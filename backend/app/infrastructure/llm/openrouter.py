"""OpenRouter OpenAI-compatible chat completion adapter."""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import SecretStr

from app.infrastructure.llm.base import (
    LLMRequest,
    LLMResponse,
    ProviderId,
    execute_json_post,
    parse_openai_chat_response,
    require_non_empty_secret,
    validate_model_id,
)


class OpenRouterAdapter:
    def __init__(
        self,
        *,
        base_url: str = "https://openrouter.ai/api/v1",
        app_url: str = "http://localhost:5173",
        app_title: str = "Test Quality Lab",
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._app_url = app_url
        self._app_title = app_title
        self._client = client

    @property
    def provider_id(self) -> ProviderId:
        return ProviderId.OPENROUTER

    def generate(self, request: LLMRequest, api_key: SecretStr) -> LLMResponse:
        model = validate_model_id(request.model)
        raw_secret = require_non_empty_secret(api_key)
        messages: list[dict[str, str]] = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": request.user_prompt})

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": request.parameters.temperature,
            "max_tokens": request.parameters.max_tokens,
            "top_p": request.parameters.top_p,
        }
        if request.parameters.seed is not None:
            payload["seed"] = request.parameters.seed

        data, latency_ms = execute_json_post(
            provider=ProviderId.OPENROUTER,
            url=f"{self._base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {raw_secret}",
                "HTTP-Referer": self._app_url,
                "X-Title": self._app_title,
                "Content-Type": "application/json",
            },
            payload=payload,
            timeout_seconds=request.parameters.timeout_seconds,
            raw_secret=raw_secret,
            client=self._client,
        )
        return parse_openai_chat_response(ProviderId.OPENROUTER, model, data, latency_ms)
