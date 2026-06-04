from typing import Annotated

from pydantic import BeforeValidator
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_cors_origins(value: object) -> object:
    if isinstance(value, str):
        return [origin.strip() for origin in value.split(",") if origin.strip()]
    return value


class Settings(BaseSettings):
    app_name: str = "Turkuaz Marketing Parser"
    database_url: str = "sqlite:///./data/marketing_parser.db"
    auto_create_schema: bool = False
    backend_cors_origins: Annotated[list[str], BeforeValidator(parse_cors_origins)] = [
        "http://localhost:7503",
        "http://127.0.0.1:7503",
    ]
    backend_cors_origin_regex: str | None = r"https?://[^/]+:7503"
    parser_request_timeout: int = 20
    parser_max_retries: int = 3
    parser_request_delay_ms: int = 500
    parser_product_detail_request_delay_ms: int = 0
    parser_product_detail_concurrency: int = 12
    parser_concurrency: int = 3
    parser_user_agent: str = (
        "Mozilla/5.0 (compatible; MarketingParser/0.1; +https://globus-online.kg)"
    )
    auth_enabled: bool = True
    identity_secret_key: str = "dev-change-me-32-byte-secret-key-for-turkuaz-identity"
    identity_algorithm: str = "HS256"
    dev_admin_login_enabled: bool = True
    dev_admin_email: str = "admin@example.com"
    dev_admin_password: str = "admin123"
    dev_admin_full_name: str = "Parser Admin"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")


settings = Settings()
