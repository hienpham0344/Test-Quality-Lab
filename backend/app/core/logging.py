"""Central log redaction utilities ensuring API keys and credentials never leak."""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from typing import Any

REDACTED = "[REDACTED]"
_FORMATTER = logging.Formatter()
_ORIGINAL_FACTORY = logging.getLogRecordFactory()
_FACTORY_INSTALLED = False

_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)(authorization\s*:\s*bearer\s+)[^\s\"',;|]+"), rf"\1{REDACTED}"),
    (re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}"), rf"\1{REDACTED}"),
    (re.compile(r"(?i)(x-goog-api-key\s*[:=]\s*)[^\s\"',;|&]+"), rf"\1{REDACTED}"),
    (
        re.compile(
            r'(?i)("(?:api_key|apikey|secret|access_token|refresh_token|password)"\s*:\s*")[^"]+(")'
        ),
        rf"\1{REDACTED}\2",
    ),
    (
        re.compile(r"(?i)([?&](?:key|api_key|apikey|token|secret)=)[^&\s\"'|]+"),
        rf"\1{REDACTED}",
    ),
    (re.compile(r"\bgsk_[A-Za-z0-9_-]{12,}\b"), REDACTED),
    (re.compile(r"\bsk-or-v1-[A-Za-z0-9_-]{12,}\b"), REDACTED),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{16,}\b"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"), REDACTED),
)


def redact_secrets(text: str, extra_secrets: Sequence[str] = ()) -> str:
    """Replace known credential headers, token prefixes, and caller-provided secrets."""
    cleaned = text
    for raw in extra_secrets:
        candidate = raw.strip()
        if candidate:
            cleaned = cleaned.replace(candidate, REDACTED)
    for pattern, replacement in _SECRET_PATTERNS:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned


def _scrub_record_in_place(record: logging.LogRecord) -> None:
    rendered = record.getMessage()
    record.msg = redact_secrets(rendered)
    record.args = ()
    if record.exc_info:
        formatted_exc = _FORMATTER.formatException(record.exc_info)
        record.exc_text = redact_secrets(formatted_exc)
        record.exc_info = None
    elif record.exc_text:
        record.exc_text = redact_secrets(record.exc_text)


class RedactingLogFilter(logging.Filter):
    """Logging filter that formats and scrubs log messages and exception tracebacks."""

    def filter(self, record: logging.LogRecord) -> bool:
        _scrub_record_in_place(record)
        return True


def _redacting_record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
    record = _ORIGINAL_FACTORY(*args, **kwargs)
    _scrub_record_in_place(record)
    return record


def install_log_redaction(logger_name: str | None = None) -> None:
    """Attach ``RedactingLogFilter`` to logger + handlers and install record factory."""
    global _FACTORY_INSTALLED
    target = logging.getLogger(logger_name)
    if not any(isinstance(f, RedactingLogFilter) for f in target.filters):
        target.addFilter(RedactingLogFilter())
    for handler in target.handlers:
        if not any(isinstance(f, RedactingLogFilter) for f in handler.filters):
            handler.addFilter(RedactingLogFilter())
    if logger_name is None and not _FACTORY_INSTALLED:
        logging.setLogRecordFactory(_redacting_record_factory)
        _FACTORY_INSTALLED = True
