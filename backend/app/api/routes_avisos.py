from datetime import date as date_type, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin
from app.db.models import Aviso, Colaborador, Plantao, SolicitacaoFolga
from app.db.session import get_db
from app.schemas import AvisoOut

router = APIRouter(prefix="/avisos", tags=["avisos"])


@router.get("", response_model=list[AvisoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Aviso)
    if user.role != "admin":
        q = q.filter(Aviso.colaborador_id == user.id)
    return q.order_by(Aviso.data.desc()).all()


@router.post("/{aviso_id}/marcar-lido", response_model=AvisoOut)
def marcar_lido(aviso_id: str, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    alvo = db.get(Aviso, aviso_id)
    if not alvo or (user.role != "admin" and alvo.colaborador_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aviso não encontrado.")
    alvo.lido = True
    db.commit()
    return alvo


@router.post("/gerar")
def gerar(data_ref: date_type, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    """Roda as 3 regras (lista mensal dia 1, aviso semanal de segunda, cobrança
    de folga 6 dias após o plantão) para a data informada. Em produção, chame
    esse endpoint uma vez por dia via um agendador (cron / GitHub Actions
    scheduled workflow / APScheduler) em vez de disparar manualmente."""
    novos = []
    colaboradores = db.query(Colaborador).filter(Colaborador.status == "ativo").all()

    if data_ref.day == 1:
        for c in colaboradores:
            ja_existe = db.query(Aviso).filter(Aviso.colaborador_id == c.id, Aviso.tipo == "mensal", Aviso.data == data_ref).first()
            plantoes_mes = db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data >= data_ref.replace(day=1)).filter(Plantao.data < (data_ref.replace(day=28) + timedelta(days=4)).replace(day=1)).all()
            if not ja_existe and plantoes_mes:
                novos.append(Aviso(colaborador_id=c.id, tipo="mensal", data=data_ref, canais=["painel"],
                                    mensagem=f"Você tem {len(plantoes_mes)} plantão(ões) este mês."))

    if data_ref.weekday() == 0:  # segunda-feira
        semana_fim = data_ref + timedelta(days=6)
        for c in colaboradores:
            ja_existe = db.query(Aviso).filter(Aviso.colaborador_id == c.id, Aviso.tipo == "semanal", Aviso.data == data_ref).first()
            plantoes_semana = db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data >= data_ref, Plantao.data <= semana_fim).all()
            if not ja_existe and plantoes_semana:
                novos.append(Aviso(colaborador_id=c.id, tipo="semanal", data=data_ref, canais=["painel"],
                                    mensagem=f"Esta semana você tem {len(plantoes_semana)} plantão(ões)."))

    plantoes_todos = db.query(Plantao).all()
    for p in plantoes_todos:
        prazo = p.data + timedelta(days=6)
        if data_ref > prazo:
            tem_solicitacao = db.query(SolicitacaoFolga).filter(SolicitacaoFolga.plantao_id == p.id, SolicitacaoFolga.status != "rejeitada").first()
            ja_avisado = db.query(Aviso).filter(Aviso.tipo == "cobranca", Aviso.colaborador_id == p.colaborador_id, Aviso.data == data_ref).first()
            if not tem_solicitacao and not ja_avisado:
                novos.append(Aviso(colaborador_id=p.colaborador_id, tipo="cobranca", data=data_ref, canais=["painel"],
                                    mensagem=f"Pendente: agende a folga do plantão de {p.data.strftime('%d/%m/%Y')} (prazo era {prazo.strftime('%d/%m/%Y')})."))

    for n in novos:
        db.add(n)
    db.commit()
    log_action(db, request, admin, "gerar_avisos", "aviso", None, {"quantidade": len(novos)})
    return {"gerados": len(novos)}
