"""Per-run generation error classification (SRS v1.2 FR-AIC-004, FR-GEN-005, §3.15) — issue #41.

Every failure ends with a stage, a code and a time. Unknown errors are recorded as
``UNKNOWN_PROVIDER_ERROR`` and never reported as Completed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

import httpx

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm.base import ProviderHTTPError

_HTTP_STATUS_RE = re.compile(r"\bHTTP\s+(\d{3})\b")
# Provider wording for an exhausted quota or billing limit (OpenAI-compatible, Gemini, OpenRouter).
_QUOTA_RE = re.compile(
    r"quota|insufficient[_ ]?(credits|funds|balance)|billing|exceeded your current|"
    r"credit(s)? (limit|exhausted)|RESOURCE_EXHAUSTED|payment required",
    re.IGNORECASE,
)


class ProviderErrorKind(StrEnum):
    AUTH = "AUTH"
    QUOTA = "QUOTA"
    RATE_LIMIT = "RATE_LIMIT"
    TIMEOUT = "TIMEOUT"
    SERVICE = "SERVICE"
    BAD_REQUEST = "BAD_REQUEST"
    CREDENTIAL = "CREDENTIAL"
    PROMPT = "PROMPT"
    ARTIFACT = "ARTIFACT"
    UNKNOWN = "UNKNOWN"


class RunErrorCode(StrEnum):
    PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED"
    PROVIDER_QUOTA_EXHAUSTED = "PROVIDER_QUOTA_EXHAUSTED"
    PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED"
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_BAD_REQUEST = "PROVIDER_BAD_REQUEST"
    PROVIDER_PAUSED = "PROVIDER_PAUSED"
    ARTIFACT_INVALID = "ARTIFACT_INVALID"
    UNKNOWN_PROVIDER_ERROR = "UNKNOWN_PROVIDER_ERROR"


@dataclass(frozen=True)
class RunErrorClass:
    kind: ProviderErrorKind
    stage: str
    code: str
    retryable: bool
    #: True when the provider/key cannot serve more runs now: unsent runs for it are paused.
    pauses_provider: bool = False
    retry_after: float | None = None

    @property
    def is_timeout(self) -> bool:
        return self.kind == ProviderErrorKind.TIMEOUT


def _http_status(exc: AppError) -> int | None:
    if isinstance(exc, ProviderHTTPError):
        return exc.status_code
    match = _HTTP_STATUS_RE.search(exc.message)
    return int(match.group(1)) if match else None


def _is_timeout(exc: BaseException) -> bool:
    timeouts = (TimeoutError, httpx.TimeoutException)
    return isinstance(exc, timeouts) or isinstance(exc.__cause__, timeouts)


def classify_run_error(exc: BaseException) -> RunErrorClass:
    """Maps an exception raised while generating one run to its kind, stage, code and retry policy."""
    if _is_timeout(exc):
        return RunErrorClass(ProviderErrorKind.TIMEOUT, "provider", RunErrorCode.PROVIDER_TIMEOUT, False)

    if isinstance(exc, AppError):
        if exc.code == ErrorCode.ACCESS_DENIED:
            return RunErrorClass(ProviderErrorKind.ARTIFACT, "artifact", exc.code.value, False)
        if exc.code == ErrorCode.CREDENTIAL_MISSING:
            return RunErrorClass(ProviderErrorKind.CREDENTIAL, "credential", exc.code.value, False)
        if exc.code in (ErrorCode.PROMPT_NOT_APPROVED, ErrorCode.INPUT_INVALID):
            return RunErrorClass(ProviderErrorKind.PROMPT, "prompt", exc.code.value, False)
        if exc.code == ErrorCode.SERVICE_UNAVAILABLE:
            return RunErrorClass(ProviderErrorKind.SERVICE, "provider", RunErrorCode.PROVIDER_UNAVAILABLE, True)
        if exc.code == ErrorCode.PROVIDER_UPSTREAM_ERROR:
            return _classify_upstream(exc)
        return RunErrorClass(ProviderErrorKind.UNKNOWN, "provider", RunErrorCode.UNKNOWN_PROVIDER_ERROR, False)

    if isinstance(exc, httpx.TransportError):
        return RunErrorClass(ProviderErrorKind.SERVICE, "provider", RunErrorCode.PROVIDER_UNAVAILABLE, True)
    return RunErrorClass(ProviderErrorKind.UNKNOWN, "provider", RunErrorCode.UNKNOWN_PROVIDER_ERROR, False)


def _classify_upstream(exc: AppError) -> RunErrorClass:
    status = _http_status(exc)
    retry_after = exc.retry_after if isinstance(exc, ProviderHTTPError) else None
    if status in (401, 403):
        return RunErrorClass(ProviderErrorKind.AUTH, "provider", RunErrorCode.PROVIDER_AUTH_FAILED, False)
    if status == 402 or (status == 429 and _QUOTA_RE.search(exc.message)):
        return RunErrorClass(
            ProviderErrorKind.QUOTA, "provider", RunErrorCode.PROVIDER_QUOTA_EXHAUSTED, False,
            pauses_provider=True,
        )
    if status == 429:
        return RunErrorClass(
            ProviderErrorKind.RATE_LIMIT, "provider", RunErrorCode.PROVIDER_RATE_LIMITED, True,
            pauses_provider=True, retry_after=retry_after,
        )
    if status is not None and status >= 500:
        return RunErrorClass(
            ProviderErrorKind.SERVICE, "provider", RunErrorCode.PROVIDER_UNAVAILABLE, True,
            retry_after=retry_after,
        )
    if status is not None and 400 <= status < 500:
        return RunErrorClass(ProviderErrorKind.BAD_REQUEST, "provider", RunErrorCode.PROVIDER_BAD_REQUEST, False)
    if isinstance(exc.__cause__, httpx.TransportError):
        return RunErrorClass(ProviderErrorKind.SERVICE, "provider", RunErrorCode.PROVIDER_UNAVAILABLE, True)
    # Malformed JSON, missing choices, empty content: the provider answered with something unusable.
    return RunErrorClass(ProviderErrorKind.UNKNOWN, "provider", RunErrorCode.UNKNOWN_PROVIDER_ERROR, False)
