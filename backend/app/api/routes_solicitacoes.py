from datetime import datetime, date as date_type

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin
from app.db.models import Colaborador, Plantao, SolicitacaoFolga
from app.db.session import get_db
from app.logic import horarios_similares
from app.schemas import ResolverSolicitacaoIn, SolicitacaoIn, SolicitacaoOut

router = APIRouter(prefix="/solicitacoes", tags=["solicitacoes"])


@router.get("", response_model=list[SolicitacaoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(SolicitacaoFolga)
    if user.role != "admin":
        q = q.filter(SolicitacaoFolga.colaborador_id == user.id)
    return q.order_by(SolicitacaoFolga.data_solicitada.desc()).all()


@router.post("", response_model=SolicitacaoOut, status_code=status.HTTP_201_CREATED)
def solicitar(body: SolicitacaoIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    if body.tipo == "folga_plantao":
        if not body.plantao_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o plantão vinculado.")
        plantao = db.get(Plantao, body.plantao_id)
        if not plantao or plantao.colaborador_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado para este colaborador.")
        ja_tem = db.query(SolicitacaoFolga).filter(SolicitacaoFolga.plantao_id == body.plantao_id).first()
        if ja_tem:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esse plantão já tem uma folga solicitada.")
        prazo = plantao.data.toordinal() + 6
        if body.data_solicitada.toordinal() > prazo or body.data_solicitada <= plantao.data:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A data da folga deve estar entre o dia seguinte ao plantão e até 6 dias depois.")

    # checagem de conflito: colegas com horário igual/parecido já de folga na mesma data
    colegas = db.query(Colaborador).filter(Colaborador.id != user.id).all()
    colegas_similares_ids = {
        c.id for c in colegas
        if horarios_similares(user.horario_inicio, user.horario_fim, c.horario_inicio, c.horario_fim)
    }
    conflito = None
    if colegas_similares_ids:
        conflito = (
            db.query(SolicitacaoFolga)
            .filter(SolicitacaoFolga.status != "rejeitada",
                     SolicitacaoFolga.data_solicitada == body.data_solicitada,
                     SolicitacaoFolga.colaborador_id.in_(colegas_similares_ids))
            .first()
        )
    if conflito and not body.ignorar_aviso:
        nome_colega = db.get(Colaborador, conflito.colaborador_id).nome
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{nome_colega}, com horário igual ou parecido ao seu, já tem folga "
            f"{'aprovada' if conflito.status == 'aprovada' else 'solicitada'} nessa data. "
            "Envie novamente com 'ignorar_aviso' para confirmar mesmo assim.",
        )

    nova = SolicitacaoFolga(
        colaborador_id=user.id, tipo=body.tipo, plantao_id=body.plantao_id,
        data_solicitada=body.data_solicitada, status="pendente",
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    log_action(db, request, user, "solicitar_folga", "solicitacao_folga", nova.id)
    return nova


@router.post("/{solicitacao_id}/resolver", response_model=SolicitacaoOut)
def resolver(solicitacao_id: str, body: ResolverSolicitacaoIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(SolicitacaoFolga, solicitacao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitação não encontrada.")
    if alvo.status != "pendente":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Essa solicitação já foi resolvida.")

    if not body.aprovar and not (body.motivo_rejeicao and body.motivo_rejeicao.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o motivo da rejeição.")

    alvo.status = "aprovada" if body.aprovar else "rejeitada"
    alvo.motivo_rejeicao = body.motivo_rejeicao if not body.aprovar else None
    alvo.resolved_by = admin.id
    alvo.resolved_at = datetime.utcnow()
    db.commit()
    log_action(db, request, admin, "resolver_folga", "solicitacao_folga", alvo.id, {"aprovado": body.aprovar})
    return alvo
