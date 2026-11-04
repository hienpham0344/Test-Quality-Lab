from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.infrastructure.email import smtp as email_adapter


def test_verification_link_sends_token_in_fragment(monkeypatch):
    messages = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            assert (host, port, timeout) == ("mailpit", 1025, 5)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def send_message(self, message):
            messages.append(message)

    monkeypatch.setattr(
        email_adapter,
        "get_settings",
        lambda: SimpleNamespace(
            smtp_host="mailpit", smtp_port=1025, public_app_url="http://localhost:5173",
            smtp_sender="Test Quality Lab <no-reply@localhost>", smtp_security="none",
            smtp_username=None, smtp_password=None,
        ),
    )
    monkeypatch.setattr(email_adapter.smtplib, "SMTP", FakeSMTP)

    email_adapter.send_auth_link("verify", "user@example.com", "one-time-token")

    assert len(messages) == 1
    assert messages[0]["To"] == "user@example.com"
    assert "http://localhost:5173/verify-email#token=one-time-token" in messages[0].get_content()


def test_remote_smtp_rejects_plaintext_and_local_sender(monkeypatch):
    settings = SimpleNamespace(
        smtp_host="smtp.example.com", smtp_port=587,
        public_app_url="https://lab.example.com", smtp_sender="no-reply@example.com",
        smtp_security="none", smtp_username=None, smtp_password=None,
    )
    monkeypatch.setattr(email_adapter, "get_settings", lambda: settings)
    with pytest.raises(ValueError, match="TLS"):
        email_adapter.send_auth_link("reset", "user@example.com", "token")

    settings.smtp_security = "starttls"
    settings.smtp_sender = "no-reply@localhost"
    with pytest.raises(ValueError, match="sender"):
        email_adapter.send_auth_link("reset", "user@example.com", "token")


def test_remote_smtp_uses_tls_authentication_and_configured_sender(monkeypatch):
    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls.append(("connect", host, port, timeout))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def starttls(self, context):
            assert context is not None
            calls.append(("starttls",))

        def login(self, username, password):
            calls.append(("login", username, password))

        def send_message(self, message):
            calls.append(("send", message["From"], message["To"]))

    monkeypatch.setattr(
        email_adapter, "get_settings",
        lambda: SimpleNamespace(
            smtp_host="smtp.example.com", smtp_port=587,
            public_app_url="https://lab.example.com", smtp_sender="no-reply@example.com",
            smtp_security="starttls", smtp_username="mailer",
            smtp_password=SecretStr("test-only-password"),
        ),
    )
    monkeypatch.setattr(email_adapter.smtplib, "SMTP", FakeSMTP)
    email_adapter.send_auth_link("reset", "user@example.com", "token")
    assert [call[0] for call in calls] == ["connect", "starttls", "login", "send"]
    assert calls[-1] == ("send", "no-reply@example.com", "user@example.com")
