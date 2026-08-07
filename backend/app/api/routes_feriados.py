from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin
from app.db.models import Colaborador, Feriado
from app.db.session import get_db
from app.schemas import FeriadoIn, FeriadoOut

router = APIRouter(prefix="/feriados", tags=["feriados"])


@router.get("", response_model=list[FeriadoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    return db.query(Feriado).order_by(Feriado.data).all()


@router.post("", response_model=FeriadoOut, status_code=status.HTTP_201_CREATED)
def criar(body: FeriadoIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    novo = Feriado(data=body.data, nome=body.nome, tipo=body.tipo, trabalha=(body.tipo == "obrigatorio"))
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, admin, "criar_feriado", "feriado", novo.id)
    return novo


@router.post("/{feriado_id}/alternar-trabalha", response_model=FeriadoOut)
def alternar_trabalha(feriado_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Feriado, feriado_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Feriado não encontrado.")
    if alvo.tipo == "obrigatorio":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Feriado obrigatório sempre gera plantão.")
    alvo.trabalha = not alvo.trabalha
    db.commit()
    log_action(db, request, admin, "alternar_feriado", "feriado", alvo.id)
    return alvo


@router.delete("/{feriado_id}")
def remover(feriado_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Feriado, feriado_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Feriado não encontrado.")
    db.delete(alvo)
    db.commit()
    log_action(db, request, admin, "remover_feriado", "feriado", feriado_id)
    return {"ok": True}
