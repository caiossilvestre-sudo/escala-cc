from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_colaborador, log_action
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token, generate_refresh_token_raw, hash_password,
    hash_token, verify_password,
)
from app.db.models import Colaborador, RefreshToken
from app.db.session import get_db
from app.schemas import ChangePasswordIn, LoginIn, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"


def _set_refresh_cookie(response: Response, raw_token: str):
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw_token,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        path="/auth",
    )


@router.post("/login", response_model=TokenOut)
@limiter.limit("5/minute")
def login(request: Request, response: Response, body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(Colaborador).filter(Colaborador.email == body.email.lower()).first()

    # Mensagem genérica de propósito: não revela se o e-mail existe ou não.
    generic_error = HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha inválidos.")

    if user is None:
        raise generic_error

    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status.HTTP_423_LOCKED, "Conta temporariamente bloqueada por tentativas incorretas. Tente novamente mais tarde.")

    if user.status != "ativo":
        raise generic_error

    if not verify_password(body.password, user.password_hash):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= settings.max_login_attempts:
            user.locked_until = datetime.utcnow() + timedelta(minutes=settings.lockout_minutes)
            user.failed_attempts = 0
        db.commit()
        log_action(db, request, None, "login_falhou", "colaborador", user.id)
        raise generic_error

    # login OK
    user.failed_attempts = 0
    user.locked_until = None
    db.commit()

    access_token = create_access_token(subject=user.id, role=user.role)

    raw_refresh = generate_refresh_token_raw()
    db.add(RefreshToken(
        colaborador_id=user.id,
        token_hash=hash_token(raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days),
    ))
    db.commit()
    _set_refresh_cookie(response, raw_refresh)

    log_action(db, request, user, "login", "colaborador", user.id)

    return TokenOut(
        access_token=access_token, role=user.role, colaborador_id=user.id,
        nome=user.nome, must_change_password=user.must_change_password,
    )


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada, faça login novamente.")

    token_hash = hash_token(raw)
    stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if not stored or stored.revoked or stored.expires_at < datetime.utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada, faça login novamente.")

    user = db.get(Colaborador, stored.colaborador_id)
    if not user or user.status != "ativo":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inválido.")

    # Rotação: revoga o token usado e emite um novo (mitiga reuso de token roubado)
    stored.revoked = True
    new_raw = generate_refresh_token_raw()
    db.add(RefreshToken(
        colaborador_id=user.id,
        token_hash=hash_token(new_raw),
        expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days),
    ))
    db.commit()
    _set_refresh_cookie(response, new_raw)

    access_token = create_access_token(subject=user.id, role=user.role)
    return TokenOut(
        access_token=access_token, role=user.role, colaborador_id=user.id,
        nome=user.nome, must_change_password=user.must_change_password,
    )


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        stored = db.query(RefreshToken).filter(RefreshToken.token_hash == hash_token(raw)).first()
        if stored:
            stored.revoked = True
            db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/auth")
    return {"ok": True}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    if not verify_password(body.senha_atual, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Senha atual incorreta.")
    user.password_hash = hash_password(body.nova_senha)
    user.must_change_password = False
    db.commit()
    log_action(db, request, user, "trocar_senha", "colaborador", user.id)
    return {"ok": True}
