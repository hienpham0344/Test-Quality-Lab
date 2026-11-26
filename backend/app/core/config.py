from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://tql_dev:change-me-local-only@localhost:5432/test_quality_lab"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:5173"
    artifact_dir: str = "/app/artifacts"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_security: Literal["none", "starttls", "ssl"] = "none"
    smtp_sender: str = "Test Quality Lab <no-reply@localhost>"
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    public_app_url: str = "http://localhost:5173"
    credential_encryption_keys: SecretStr | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_timeout_seconds: float = 30.0
    # Sandbox execution (FR-EXE, NFR-SEC-002). Disabled until the sandbox security review passes:
    # running needs BOTH the flag and a recorded review ID, and a dedicated launcher service.
    sandbox_execution_enabled: bool = False
    sandbox_security_review_id: str | None = None
    sandbox_image: str = "tql-sandbox:unreviewed"
    sandbox_workdir: str = "/app/sandbox-work"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
