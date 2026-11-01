import smtplib
from email.message import EmailMessage
from urllib.parse import quote

from app.core.config import get_settings


def send_auth_link(kind: str, address: str, token: str) -> None:
    settings = get_settings()
    path = "verify-email" if kind == "verify" else "reset-password"
    subject = "Verify your email" if kind == "verify" else "Reset your password"
    link = f"{settings.public_app_url.rstrip('/')}/{path}#token={quote(token)}"
    message = EmailMessage()
    message["From"] = "Test Quality Lab <no-reply@localhost>"
    message["To"] = address
    message["Subject"] = subject
    message.set_content(f"Open this link within 30 minutes:\n{link}\n")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=5) as smtp:
        smtp.send_message(message)
