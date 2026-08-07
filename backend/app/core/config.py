"""
Configurações da aplicação, lidas de variáveis de ambiente (.env).
NUNCA coloque valores reais de segredo neste arquivo — sempre via .env,
que fica fora do controle de versão (veja .gitignore).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Banco de dados. Para testar localmente sem instalar Postgres, use:
    #   DATABASE_URL=sqlite:///./dev.db
    # Em produção, use uma URL do Postgres (ex: Supabase, Neon, Railway).
    database_url: str = "sqlite:///./dev.db"

    # Segredo usado para assinar os tokens JWT. OBRIGATÓRIO trocar em produção.
    # Gere um valor forte com: python -c "import secrets; print(secrets.token_urlsafe(64))"
    jwt_secret: str = "CHANGE-ME-INSECURE-DEFAULT-DO-NOT-USE-IN-PRODUCTION"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # Origem exata do frontend (sem barra no final). Em produção, coloque a
    # URL pública do site (ex: https://escala.suaempresa.com.br).
    frontend_origin: str = "http://localhost:5173"

    # Ambiente: "development" ou "production". Em produção, cookies exigem HTTPS.
    environment: str = "development"

    # Limite de tentativas de login antes de bloquear temporariamente a conta.
    max_login_attempts: int = 5
    lockout_minutes: int = 15


settings = Settings()
