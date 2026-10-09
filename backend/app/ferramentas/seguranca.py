"""Permissões do módulo e criptografia das senhas dos gravadores."""
import os

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador
from app.db.models import Colaborador
from app.db.session import get_db
from app.ferramentas.models import FtAcesso

# Catálogo de permissões, por página/tópico. A ordem é a da tela.
PERMISSOES = {
    "doc.ver": "Documentação · consultar e exportar",
    "doc.editar": "Documentação · cadastrar/editar e importar fotos",
    "doc.senhas": "Documentação · ver senhas dos gravadores",
    "doc.excluir": "Documentação · excluir câmeras LifeGuard",
    "nvr.gerenciar": "Gravadores · incluir, editar, desativar, excluir e liberar canais",
    "ft.admin": "Gerenciar permissões",
}
# Atalhos da tela de permissões (só preenchem as caixinhas)
PRESETS = {
    "n1": ["doc.ver", "doc.editar"],
    "n2": ["doc.ver", "doc.editar", "doc.senhas"],
}
# Quem tem uma permissão de Documentação precisa conseguir consultar
IMPLICA = {"doc.editar": "doc.ver", "doc.senhas": "doc.ver", "doc.excluir": "doc.ver", "nvr.gerenciar": "doc.ver"}


def normalizar_permissoes(lista) -> list[str]:
    final = {p for p in (lista or []) if p in PERMISSOES}
    for p, base in IMPLICA.items():
        if p in final:
            final.add(base)
    return [p for p in PERMISSOES if p in final]  # ordem do catálogo


# ---------------------------------------------------------------- permissões

def permissoes_do(db: Session, user: Colaborador) -> set[str]:
    """Admin do Escala tem tudo. Os demais: o que estiver em ft_acessos."""
    if user.role == "admin":
        return set(PERMISSOES)
    a = db.get(FtAcesso, user.id)
    return set(normalizar_permissoes(a.permissoes)) if a else set()


def exigir(permissao: str):
    def dep(user: Colaborador = Depends(get_current_colaborador), db: Session = Depends(get_db)) -> Colaborador:
        perms = permissoes_do(db, user)
        if not perms:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem acesso ao módulo Ferramentas. Peça liberação a um administrador.")
        if permissao not in perms:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Sem permissão para: {PERMISSOES[permissao]}.")
        user.ft_permissoes = perms  # atributo só em memória, para as rotas usarem
        return user
    return dep


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
