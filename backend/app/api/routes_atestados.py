from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import check_escopo_equipe, get_current_colaborador, log_action, require_admin_or_supervisor
from app.db.models import Atestado, Colaborador
from app.db.session import get_db
from app.schemas import AtestadoIn, AtestadoOut

router = APIRouter(prefix="/atestados", tags=["atestados"])


@router.get("", response_model=list[AtestadoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Atestado)
    if user.role in ("colaborador", "supervisor"):
        colegas_ids = [c.id for c in db.query(Colaborador.id).filter(Colaborador.equipe == user.equipe)]
        q = q.filter(Atestado.colaborador_id.in_(colegas_ids))
    return q.order_by(Atestado.data_inicio.desc()).all()


@router.post("", response_model=AtestadoOut, status_code=status.HTTP_201_CREATED)
def criar(body: AtestadoIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Colaborador, body.colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    check_escopo_equipe(user, alvo.equipe)
    novo = Atestado(**body.model_dump(), created_by=user.id)
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, user, "criar_atestado", "atestado", novo.id)
    return novo
