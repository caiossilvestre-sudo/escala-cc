import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import (
    routes_atestados, routes_auth, routes_avisos, routes_colaboradores,
    routes_feriados, routes_ferias, routes_plantoes, routes_solicitacoes,
)
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import hash_password
from app.db.models import Colaborador
from app.db.session import Base, SessionLocal, engine
from app.middleware.security_headers import SecurityHeadersMiddleware

app = FastAPI(title="Escala CC API", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(SecurityHeadersMiddleware)

# CORS: só a origem exata do frontend, com suporte a cookies (allow_credentials).
# Nunca use allow_origins=["*"] junto de allow_credentials=True — isso anularia
# a proteção de origem.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(routes_auth.router)
app.include_router(routes_colaboradores.router)
app.include_router(routes_plantoes.router)
app.include_router(routes_plantoes.templates_router)
app.include_router(routes_solicitacoes.router)
app.include_router(routes_atestados.router)
app.include_router(routes_ferias.router)
app.include_router(routes_feriados.router)
app.include_router(routes_avisos.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

    # Cria o primeiro admin automaticamente SÓ se ainda não existir nenhum
    # colaborador no banco. As credenciais vêm de variáveis de ambiente —
    # nunca ficam fixas no código.
    db = SessionLocal()
    try:
        if db.query(Colaborador).count() == 0:
            admin_email = os.getenv("FIRST_ADMIN_EMAIL")
            admin_password = os.getenv("FIRST_ADMIN_PASSWORD")
            if admin_email and admin_password:
                admin = Colaborador(
                    nome="Administrador", email=admin_email.lower(), role="admin",
                    equipe="Suporte N1", turno="Manhã", escala_tipo="6x2",
                    horario_inicio="08:00", horario_fim="17:00",
                    password_hash=hash_password(admin_password),
                    must_change_password=True,
                )
                db.add(admin)
                db.commit()
                print(f"[seed] Admin inicial criado: {admin_email} (troque a senha no primeiro login).")
            else:
                print("[seed] Nenhum colaborador no banco e FIRST_ADMIN_EMAIL/FIRST_ADMIN_PASSWORD "
                      "não definidos — crie o primeiro admin manualmente (veja README.md).")
    finally:
        db.close()
