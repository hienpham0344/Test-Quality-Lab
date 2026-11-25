import json

import httpx
import pytest
from pydantic import SecretStr

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm import (
    GeminiAdapter,
    GenerationParameters,
    GroqAdapter,
    LLMRequest,
    OpenRouterAdapter,
    ProviderId,
    ProviderRegistry,
    validate_model_id,
)


def test_validate_model_id_accepts_provider_slugs_and_blocks_injection() -> None:
    assert validate_model_id("llama-3.3-70b-versatile") == "llama-3.3-70b-versatile"
    assert validate_model_id("meta-llama/llama-3.3-70b-instruct:free") == (
        "meta-llama/llama-3.3-70b-instruct:free"
    )

    for bad in ["", "   ", "a" * 121, "../secret", "gemini-2.5-flash?key=leak", "bad model"]:
        with pytest.raises(AppError) as exc_info:
            validate_model_id(bad)
        assert exc_info.value.code == ErrorCode.INPUT_INVALID


def test_groq_adapter_formats_openai_payload_and_parses_usage() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "model": "llama-3.3-70b-versatile",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "def test_add(): assert add(1, 2) == 3"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 42, "completion_tokens": 18, "total_tokens": 60},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = GroqAdapter(base_url="https://api.groq.com/openai/v1", client=client)
    req = LLMRequest(
        model="llama-3.3-70b-versatile",
        system_prompt="Generate pytest tests.",
        user_prompt="def add(a, b): return a + b",
        parameters=GenerationParameters(temperature=0.2, max_tokens=512, top_p=0.9, seed=7),
    )

    res = adapter.generate(req, SecretStr("gsk_test_secret_1234567890"))
    assert captured["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert captured["auth"] == "Bearer gsk_test_secret_1234567890"
    assert res.provider == ProviderId.GROQ
    assert res.content == "def test_add(): assert add(1, 2) == 3"
    assert res.finish_reason == "stop"
    assert res.usage.total_tokens == 60


def test_gemini_adapter_sends_header_key_never_query_param() -> None:
    captured: dict[str, object] = {}
    raw_key = "AIzaSyGeminiUnitTestKey1234567890"

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["api_key_header"] = request.headers.get("x-goog-api-key")
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {"parts": [{"text": "def test_sub():\n    assert sub(5, 3) == 2"}]},
                        "finishReason": "STOP",
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 30,
                    "candidatesTokenCount": 15,
                    "totalTokenCount": 45,
                },
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = GeminiAdapter(base_url="https://generativelanguage.googleapis.com/v1beta", client=client)
    req = LLMRequest(
        model="gemini-2.5-flash",
        system_prompt="Only output Python code.",
        user_prompt="def sub(a, b): return a - b",
        parameters=GenerationParameters(temperature=0.0, max_tokens=1024, top_p=1.0),
    )

    res = adapter.generate(req, SecretStr(raw_key))
    assert raw_key not in str(captured["url"])
    assert captured["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    )
    assert captured["api_key_header"] == raw_key
    assert res.provider == ProviderId.GEMINI
    assert "def test_sub()" in res.content
    assert res.usage.prompt_tokens == 30
    assert res.usage.completion_tokens == 15
    assert res.usage.total_tokens == 45


def test_openrouter_scrubs_reflected_api_key_from_upstream_error() -> None:
    reflected_secret = "custom-openrouter-raw-secret-xyz987"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("HTTP-Referer") == "http://localhost:5173"
        return httpx.Response(
            401,
            json={"error": {"message": f"Invalid key supplied: {reflected_secret}"}},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = OpenRouterAdapter(
        base_url="https://openrouter.ai/api/v1",
        app_url="http://localhost:5173",
        client=client,
    )
    req = LLMRequest(
        model="openai/gpt-4o-mini",
        system_prompt=None,
        user_prompt="def mul(a, b): return a * b",
    )

    with pytest.raises(AppError) as exc_info:
        adapter.generate(req, SecretStr(reflected_secret))

    assert exc_info.value.code == ErrorCode.PROVIDER_UPSTREAM_ERROR
    assert reflected_secret not in exc_info.value.message
    assert "[REDACTED]" in exc_info.value.message


def test_provider_registry_resolves_supported_and_rejects_unknown() -> None:
    registry = ProviderRegistry.default()
    assert set(registry.list_providers()) == {
        ProviderId.GROQ,
        ProviderId.GEMINI,
        ProviderId.OPENROUTER,
    }
    with pytest.raises(AppError) as exc_info:
        registry.get("unsupported-vendor")
    assert exc_info.value.code == ErrorCode.PROVIDER_UNSUPPORTED


def test_adapters_reject_empty_secret_and_boolean_token_counts() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "llama-3.3-70b-versatile",
                "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": True, "completion_tokens": False, "total_tokens": 5},
            },
        )

    adapter = GroqAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))
    req = LLMRequest(model="llama-3.3-70b-versatile", user_prompt="hi")

    with pytest.raises(AppError) as empty_key:
        adapter.generate(req, SecretStr("   "))
    assert empty_key.value.code == ErrorCode.CREDENTIAL_MISSING

    res = adapter.generate(req, SecretStr("gsk_valid_secret_12345678"))
    assert res.usage.prompt_tokens is None
    assert res.usage.completion_tokens is None
    assert res.usage.total_tokens == 5
