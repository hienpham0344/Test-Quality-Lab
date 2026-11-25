import io
import logging

from app.core.logging import RedactingLogFilter, install_log_redaction, redact_secrets


def test_redact_secrets_scrubs_headers_provider_prefixes_and_extra_values() -> None:
    raw_custom = "custom-provider-token-99887766"
    sample = (
        "Authorization: Bearer gsk_abcdef1234567890xyz | "
        "x-goog-api-key: AIzaSyD1234567890abcdefghijklmnop | "
        '{"api_key": "sk-or-v1-11223344556677889900aabbccddeeff"} | '
        f"url=https://example.test/v1?key=AIzaSyD1234567890abcdefghijklmnop&raw={raw_custom}"
    )

    cleaned = redact_secrets(sample, extra_secrets=[raw_custom])
    assert "gsk_abcdef" not in cleaned
    assert "AIzaSyD1234567890" not in cleaned
    assert "sk-or-v1-" not in cleaned
    assert raw_custom not in cleaned
    assert "[REDACTED]" in cleaned


def test_redacting_log_filter_scrubs_message_and_percent_args() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(RedactingLogFilter())
    logger = logging.getLogger("tql.test.redaction")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    secret = "gsk_999988887777666655554444"
    logger.error("Provider call failed with header Bearer %s", secret)

    output = stream.getvalue()
    assert secret not in output
    assert "[REDACTED]" in output


def test_child_logger_propagation_and_exc_info_traceback_are_redacted() -> None:
    stream = io.StringIO()
    parent = logging.getLogger("tql.parent")
    parent.handlers = [logging.StreamHandler(stream)]
    parent.setLevel(logging.INFO)
    parent.propagate = False
    install_log_redaction("tql.parent")

    child = logging.getLogger("tql.parent.child.http")
    secret = "AIzaSyChildLoggerSecretKey1234567890"
    try:
        raise RuntimeError(f"Socket failed with header x-goog-api-key: {secret}")
    except RuntimeError:
        child.exception("Unhandled transport exception for Bearer gsk_abcdef1234567890")

    rendered = stream.getvalue()
    assert secret not in rendered
    assert "gsk_abcdef1234567890" not in rendered
    assert "[REDACTED]" in rendered
