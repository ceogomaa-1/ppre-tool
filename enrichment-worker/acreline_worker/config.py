from functools import lru_cache

from pydantic import Field, HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: HttpUrl
    supabase_service_role_key: SecretStr
    openai_api_key: SecretStr
    worker_shared_secret: SecretStr = Field(min_length=24)
    openai_model: str = "gpt-5.6-luna"
    worker_concurrency: int = Field(default=4, ge=1, le=12)
    max_sources_per_lead: int = Field(default=5, ge=1, le=8)
    scrape_timeout_seconds: float = Field(default=12, ge=3, le=30)
    cache_ttl_days: int = Field(default=30, ge=1, le=180)
    allowed_domains: str = ""
    blocked_domains: str = "facebook.com,instagram.com,tiktok.com"

    @property
    def allowed_domain_set(self) -> set[str]:
        return {item.strip().lower() for item in self.allowed_domains.split(",") if item.strip()}

    @property
    def blocked_domain_set(self) -> set[str]:
        return {item.strip().lower() for item in self.blocked_domains.split(",") if item.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
