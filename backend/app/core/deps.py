from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.models import Colaborador, AuditLog
from app.db.session import get_db

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_colaborador(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Colaborador:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado.")
    payload = decode_token(creds.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido ou expirado.")
    user = db.get(Colaborador, payload.get("sub"))
    if user is None or user.status != "ativo":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inválido ou inativo.")
    return user


def require_admin(user: Colaborador = Depends(get_current_colaborador)) -> Colaborador:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ação restrita a administradores.")
    return user


def require_admin_or_supervisor(user: Colaborador = Depends(get_current_colaborador)) -> Colaborador:
    """Admin edita tudo. Supervisor também pode editar, mas só dentro do
    próprio setor — a checagem de qual setor é feita rota a rota, com
    check_escopo_equipe, depois que sabemos qual registro está sendo tocado."""
    if user.role not in ("admin", "supervisor"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ação restrita a administradores e supervisores.")
    return user


def check_escopo_equipe(user: Colaborador, equipe_alvo: str):
    """Bloqueia um supervisor de agir fora do próprio setor. Admin nunca é
    restrito por esta checagem."""
    if user.role == "supervisor" and equipe_alvo != user.equipe:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Fora do seu setor — supervisores só atuam na própria equipe.")


def require_leitura_ampla(user: Colaborador = Depends(get_current_colaborador)) -> Colaborador:
    """Pra rotas de consulta que admin e visualizador podem ver, mas
    colaborador comum não (dados sensíveis/administrativos, só leitura)."""
    if user.role not in ("admin", "visualizador"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso restrito a administradores e visualizadores.")
    return user


def log_action(db: Session, request: Request, user: Colaborador | None, acao: str, entidade: str, entidade_id: str | None = None, detalhes: dict | None = None):
    """Grava um registro de auditoria. Nunca deve derrubar a requisição principal
    se falhar — por isso é chamado depois da operação principal já ter sucedido."""
    try:
        entry = AuditLog(
            colaborador_id=user.id if user else None,
            acao=acao,
            entidade=entidade,
            entidade_id=entidade_id,
            detalhes=detalhes or {},
            ip_address=request.client.host if request.client else None,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
