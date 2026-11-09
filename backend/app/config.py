from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://jobassistent:jobassistent@localhost:5432/jobassistent"
    jwt_secret: str = "dev-only-secret-change-me-at-least-32-bytes"
    cookie_secure: bool = False  # set true when served over HTTPS
    cors_origins: list[str] = ["http://localhost:5173"]
    storage_dir: str = "storage"
    app_base_url: str = "http://localhost:5173"  # used in links sent by email
    trusted_proxy_count: int = 0  # reverse proxies in front of the API, for finding client IPs

    google_client_id: str = ""
    google_client_secret: str = ""

    email_provider: Literal["console", "smtp", "fake"] = "console"
    email_from: str = "Khoj <no-reply@localhost>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True

    assistant_scheduler_enabled: bool = True
    assistant_interval_seconds: int = 1800

    llm_provider: str = "ollama"
    llm_model: str = "gpt-oss:20b"
    llm_base_url: str = "http://localhost:11434"

    embedding_provider: str = "ollama"
    embedding_model: str = "nomic-embed-text"
    embedding_base_url: str = "http://localhost:11434"


@lru_cache
def get_settings() -> Settings:
    return Settings()
