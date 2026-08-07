from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin
from app.db.models import Atestado, Colaborador
from app.db.session import get_db
from app.schemas import AtestadoIn, AtestadoOut

router = APIRouter(prefix="/atestados", tags=["atestados"])


@router.get("", response_model=list[AtestadoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Atestado)
    if user.role != "admin":
        q = q.filter(Atestado.colaborador_id == user.id)
    return q.order_by(Atestado.data_inicio.desc()).all()


@router.post("", response_model=AtestadoOut, status_code=status.HTTP_201_CREATED)
def criar(body: AtestadoIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    if not db.get(Colaborador, body.colaborador_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    novo = Atestado(**body.model_dump(), created_by=admin.id)
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, admin, "criar_atestado", "atestado", novo.id)
    return novo
