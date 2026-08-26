from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import check_escopo_equipe, get_current_colaborador, log_action, require_admin_or_supervisor
from app.db.models import Colaborador, Ferias
from app.db.session import get_db
from app.schemas import FeriasAvancarIn, FeriasIn, FeriasOut

router = APIRouter(prefix="/ferias", tags=["ferias"])

TRANSICOES_VALIDAS = {
    "solicitada": {"enviado_rh", "rejeitada"},
    "enviado_rh": {"aprovada", "ajustar"},
}


@router.get("", response_model=list[FeriasOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Ferias)
    if user.role in ("colaborador", "supervisor"):
        colegas_ids = [c.id for c in db.query(Colaborador.id).filter(Colaborador.equipe == user.equipe)]
        q = q.filter(Ferias.colaborador_id.in_(colegas_ids))
    return q.order_by(Ferias.created_at.desc()).all()


@router.post("", response_model=FeriasOut, status_code=status.HTTP_201_CREATED)
def solicitar(body: FeriasIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    if user.role == "visualizador":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Perfil de visualização não pode realizar essa ação.")
    if body.data_fim < body.data_inicio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Data final não pode ser antes da inicial.")
    nova = Ferias(colaborador_id=user.id, data_inicio=body.data_inicio, data_fim=body.data_fim, status="solicitada")
    db.add(nova)
    db.commit()
    db.refresh(nova)
    log_action(db, request, user, "solicitar_ferias", "ferias", nova.id)
    return nova


@router.delete("/{ferias_id}")
def remover(ferias_id: str, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Ferias, ferias_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitação de férias não encontrada.")
    dono = db.get(Colaborador, alvo.colaborador_id)
    if dono:
        check_escopo_equipe(user, dono.equipe)
    db.delete(alvo)
    db.commit()
    log_action(db, request, user, "remover_ferias", "ferias", ferias_id)
    return {"ok": True}


@router.post("/{ferias_id}/avancar", response_model=FeriasOut)
def avancar(ferias_id: str, body: FeriasAvancarIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Ferias, ferias_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitação de férias não encontrada.")
    dono = db.get(Colaborador, alvo.colaborador_id)
    if dono:
        check_escopo_equipe(user, dono.equipe)
    permitidas = TRANSICOES_VALIDAS.get(alvo.status, set())
    if body.status not in permitidas:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Não é possível ir de '{alvo.status}' para '{body.status}'.")
    alvo.status = body.status
    if body.nota_admin is not None:
        alvo.nota_admin = body.nota_admin
    db.commit()
    log_action(db, request, user, "avancar_ferias", "ferias", alvo.id, {"novo_status": body.status})
    return alvo
