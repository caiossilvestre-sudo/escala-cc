from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_safe_migrations():
    """Adiciona colunas/tabelas novas sem tocar em nada que já existe.
    'IF NOT EXISTS' faz isso seguro de rodar toda vez que o backend sobe — se
    a coluna já existe, não faz nada. Nenhum dado é apagado ou alterado;
    colunas novas ficam NULL pra quem já estava cadastrado antes."""
    if not settings.database_url.startswith("postgresql"):
        return  # sintaxe abaixo é específica do Postgres (produção); sqlite (testes locais) já cria tudo via create_all
    statements = [
        "ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS equipes_gerenciadas JSON",
        "ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS data_admissao DATE",
        "ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS data_aniversario DATE",
        "ALTER TABLE avisos ADD COLUMN IF NOT EXISTS vezes_mostrado INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE avisos ADD COLUMN IF NOT EXISTS lido_em TIMESTAMP",
        "ALTER TABLE avisos ADD COLUMN IF NOT EXISTS lido_via VARCHAR",
        "ALTER TABLE avisos ADD COLUMN IF NOT EXISTS email_enviado BOOLEAN",
        "ALTER TABLE avisos ADD COLUMN IF NOT EXISTS email_erro TEXT",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception as e:
                print(f"[migração] aviso (provavelmente já aplicada antes): {e}")
