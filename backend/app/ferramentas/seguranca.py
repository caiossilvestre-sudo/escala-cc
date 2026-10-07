"""Permissões do módulo e criptografia das senhas dos gravadores."""
import os

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador
from app.db.models import Colaborador
from app.db.session import get_db
from app.ferramentas.models import FtPermissao

NIVEIS = {"n1": 1, "n2": 2, "admin": 3}
NIVEL_LABEL = {"n1": "N1", "n2": "N2", "admin": "Admin"}


# ---------------------------------------------------------------- permissões

def nivel_do(db: Session, user: Colaborador) -> str | None:
    """Admin do Escala é sempre admin em Ferramentas. Os demais dependem da
    tabela ft_permissoes — sem registro lá, não têm acesso ao módulo."""
    if user.role == "admin":
        return "admin"
    p = db.get(FtPermissao, user.id)
    return p.nivel if p else None


def exigir_nivel(minimo: str):
    def dep(user: Colaborador = Depends(get_current_colaborador), db: Session = Depends(get_db)) -> Colaborador:
        nivel = nivel_do(db, user)
        if nivel is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem acesso ao módulo Ferramentas. Peça liberação a um administrador.")
        if NIVEIS[nivel] < NIVEIS[minimo]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Ação restrita ao nível {NIVEL_LABEL[minimo]} ou acima.")
        user.ft_nivel = nivel  # atributo só em memória, para as rotas usarem
        return user
    return dep


exigir_n1 = exigir_nivel("n1")
exigir_n2 = exigir_nivel("n2")
exigir_admin = exigir_nivel("admin")


# --------------------------------------------------------------- criptografia

_fernet: Fernet | None = None


def _cifra() -> Fernet:
    """Chave em FERRAMENTAS_CHAVE_CRIPTO no .env do backend. Gere com:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    ATENÇÃO: se a chave for perdida, as senhas cifradas não podem mais ser lidas."""
    global _fernet
    if _fernet is None:
        chave = os.getenv("FERRAMENTAS_CHAVE_CRIPTO", "").strip()
        if not chave:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "FERRAMENTAS_CHAVE_CRIPTO não configurada no servidor.")
        try:
            _fernet = Fernet(chave.encode())
        except Exception:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "FERRAMENTAS_CHAVE_CRIPTO inválida.")
    return _fernet


def cifrar(texto: str | None) -> str | None:
    if texto is None or texto == "":
        return None
    return _cifra().encrypt(texto.encode("utf-8")).decode("ascii")


def decifrar(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _cifra().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Não foi possível decifrar a senha (chave diferente da usada no cadastro?).")
