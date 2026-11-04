import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import quote, urlparse

from app.core.config import get_settings


def send_auth_link(kind: str, address: str, token: str) -> None:
    settings = get_settings()
    if kind not in {"verify", "reset"}:
        raise ValueError("Invalid email link kind")
    local_hosts = {"localhost", "127.0.0.1", "::1", "mailpit"}
    if settings.smtp_security == "none" and settings.smtp_host not in local_hosts:
        raise ValueError("SMTP TLS is required for remote hosts")
    if settings.smtp_host not in local_hosts and "@localhost" in settings.smtp_sender.lower():
        raise ValueError("Configure a sender address for remote SMTP")
    app_url = urlparse(settings.public_app_url)
    if app_url.scheme != "https" and app_url.hostname not in local_hosts:
        raise ValueError("HTTPS is required for public email links")
    password = settings.smtp_password.get_secret_value() if settings.smtp_password else None
    if bool(settings.smtp_username) != bool(password):
        raise ValueError("SMTP username and password must be configured together")
    path = "verify-email" if kind == "verify" else "reset-password"
    subject = "Verify your email" if kind == "verify" else "Reset your password"
    link = f"{settings.public_app_url.rstrip('/')}/{path}#token={quote(token)}"
    message = EmailMessage()
    message["From"] = settings.smtp_sender
    message["To"] = address
    message["Subject"] = subject
    message.set_content(f"Open this link within 30 minutes:\n{link}\n")
    smtp_client: smtplib.SMTP
    if settings.smtp_security == "ssl":
        smtp_client = smtplib.SMTP_SSL(
            settings.smtp_host, settings.smtp_port, timeout=5, context=ssl.create_default_context()
        )
    else:
        smtp_client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=5)
    with smtp_client as smtp:
        if settings.smtp_security == "starttls":
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username and password:
            smtp.login(settings.smtp_username, password)
        smtp.send_message(message)
