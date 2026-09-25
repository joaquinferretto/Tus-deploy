from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class RuntimeSettings(BaseSettings):
    """Central runtime configuration for worker, graph, storage and telemetry."""

    model_config = SettingsConfigDict(
        # Local configuration is rooted at the repository. Deployed secrets
        # still arrive as the canonical environment names from the platform.
        env_file=REPOSITORY_ROOT / ".env",
        env_prefix="WORKER_",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = Field(default="development")
    service_name: str = Field(default="workflow-runtime-python")
    log_level: str = Field(default="INFO")

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    langsmith_api_key: str | None = Field(default=None, alias="LANGSMITH_API_KEY")
    langsmith_endpoint: HttpUrl | str = Field(default="https://api.smith.langchain.com")
    langsmith_project: str = Field(default="golden-boilerplate")

    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    queue_ref: str | None = Field(default=None, validation_alias="QUEUE_REF")
    queue_ownership: str = Field(default="external-blocked-placeholder", validation_alias="WORKER_QUEUE_OWNERSHIP")
    database_url: str | None = Field(default=None, validation_alias="DATABASE_URL")
    enable_consumer: bool = Field(default=False, validation_alias="WORKER_ENABLE_CONSUMER")
    deployment_status: str = Field(default="external-blocked-placeholder", validation_alias="WORKER_DEPLOYMENT_STATUS")
    vector_store_backend: str = Field(default="pgvector")
    vector_collection: str = Field(default="workflow_documents")
    checkpoint_backend: str = Field(default="postgres")

    aws_region: str = Field(default="us-east-1")
    asset_bucket: str = Field(default="workflow-assets")
    asset_prefix: str = Field(default="tenants")
    local_asset_root: Path = Field(default=Path("./.runtime/assets"))
    contracts_root: Path = Field(default=Path("../../packages/contracts/schemas"))

    embeddings_model: str = Field(default="text-embedding-3-large")
    chat_model: str = Field(default="gpt-4o-mini")
    ingestion_chunk_size: int = Field(default=1200, ge=200, le=8000)
    ingestion_chunk_overlap: int = Field(default=200, ge=0, le=1000)
    max_job_concurrency: int = Field(default=10, ge=1, le=100)

    @property
    def resolved_contracts_root(self) -> Path:
        root = Path(__file__).resolve().parents[4]
        configured = self.contracts_root
        return configured if configured.is_absolute() else (root / configured).resolve()

    @property
    def resolved_asset_root(self) -> Path:
        root = Path(__file__).resolve().parents[4]
        return self.local_asset_root if self.local_asset_root.is_absolute() else (root / self.local_asset_root).resolve()

    def require_llm_credentials(self) -> None:
        if not self.openai_api_key and not self.anthropic_api_key:
            raise RuntimeError("Set OPENAI_API_KEY or ANTHROPIC_API_KEY before invoking graph nodes.")

    @property
    def postgres_dsn(self) -> str:
        """Compatibility accessor; only the canonical root DATABASE_URL may supply it."""
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required for PostgreSQL worker operations")
        return self.database_url

    @property
    def consumer_ready(self) -> bool:
        return (
            self.enable_consumer
            and self.deployment_status == "active"
            and bool(self.database_url)
            and bool(self.redis_url)
            and bool(self.queue_ref)
            and self.queue_ownership == "active"
        )


@lru_cache(maxsize=1)
def get_settings() -> RuntimeSettings:
    settings = RuntimeSettings()
    settings.resolved_asset_root.mkdir(parents=True, exist_ok=True)
    return settings
