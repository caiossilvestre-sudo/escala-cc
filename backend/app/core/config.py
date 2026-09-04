from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"
    jwt_secret: str = "CHANGE-ME-INSECURE-DEFAULT-DO-NOT-USE-IN-PRODUCTION"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    frontend_origin: str = "http://localhost:5173"
    environment: str = "development"
    max_login_attempts: int = 5
    lockout_minutes: int = 15

    # E-mail (opcional). Se smtp_host ficar vazio, o sistema simplesmente não
    # tenta enviar e-mail — os avisos continuam funcionando normalmente só no painel.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_nome: str = "Escala Suporte Técnico"


settings = Settings()
