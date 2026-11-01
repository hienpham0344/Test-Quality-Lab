from types import SimpleNamespace

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
            smtp_host="mailpit", smtp_port=1025, public_app_url="http://localhost:5173"
        ),
    )
    monkeypatch.setattr(email_adapter.smtplib, "SMTP", FakeSMTP)

    email_adapter.send_auth_link("verify", "user@example.com", "one-time-token")

    assert len(messages) == 1
    assert messages[0]["To"] == "user@example.com"
    assert "http://localhost:5173/verify-email#token=one-time-token" in messages[0].get_content()
