from datetime import datetime, date as date_type

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import check_escopo_equipe, equipes_do_supervisor, get_current_colaborador, log_action, require_admin_or_supervisor
from app.db.models import Colaborador, Plantao, SolicitacaoFolga
from app.db.session import get_db
from app.logic import dia_util_para_folga, horarios_similares, identificar_cota_sindicato, prazo_folga_plantao, resumo_cotas_sindicato
from app.schemas import ResolverSolicitacaoIn, ResumoCotasSindicatoOut, SolicitacaoIn, SolicitacaoOut

router = APIRouter(prefix="/solicitacoes", tags=["solicitacoes"])


@router.get("", response_model=list[SolicitacaoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(SolicitacaoFolga)
    if user.role == "colaborador":
        colegas_ids = [c.id for c in db.query(Colaborador.id).filter(Colaborador.equipe == user.equipe)]
        q = q.filter(SolicitacaoFolga.colaborador_id.in_(colegas_ids))
    elif user.role == "supervisor":
        colegas_ids = [c.id for c in db.query(Colaborador.id).filter(Colaborador.equipe.in_(equipes_do_supervisor(user)))]
        q = q.filter(SolicitacaoFolga.colaborador_id.in_(colegas_ids))
    return q.order_by(SolicitacaoFolga.data_solicitada.desc()).all()


@router.get("/cotas-sindicato", response_model=ResumoCotasSindicatoOut)
def cotas_sindicato(colaborador_id: str | None = None, ciclo: int | None = None, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    """Quantas das 4 folgas sindicais do ciclo já foram usadas. Sem
    colaborador_id, mostra a do próprio usuário logado; admin/supervisor
    podem consultar de qualquer colaborador (supervisor só do próprio setor)."""
    alvo_id = user.id
    if colaborador_id and colaborador_id != user.id:
        if user.role not in ("admin", "supervisor"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só admin/supervisor podem consultar cotas de outra pessoa.")
        alvo = db.get(Colaborador, colaborador_id)
        if not alvo:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
        if user.role == "supervisor":
            check_escopo_equipe(user, alvo.equipe)
        alvo_id = colaborador_id
    return resumo_cotas_sindicato(db, alvo_id, ciclo)


@router.post("", response_model=SolicitacaoOut, status_code=status.HTTP_201_CREATED)
def solicitar(body: SolicitacaoIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    if user.role == "visualizador":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Perfil de visualização não pode realizar essa ação.")

    # Admin/supervisor podem registrar uma folga diretamente em nome de
    # alguém (ex: aba Cronograma → "Nova ausência"). Nesse caso, já sai
    # aprovada — quem registrou é quem estaria aprovando de qualquer jeito.
    registrando_para_outro = body.colaborador_id is not None and body.colaborador_id != user.id
    if registrando_para_outro:
        if user.role not in ("admin", "supervisor"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só admin/supervisor podem registrar folga em nome de outra pessoa.")
        alvo = db.get(Colaborador, body.colaborador_id)
        if not alvo:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
        check_escopo_equipe(user, alvo.equipe)
    else:
        alvo = user

    plantao_id_final = body.plantao_id
    if body.tipo == "folga_plantao":
        if not plantao_id_final and body.data_plantao:
            plantao_buscado = db.query(Plantao).filter(Plantao.colaborador_id == alvo.id, Plantao.data == body.data_plantao).first()
            if not plantao_buscado:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Não encontrei nenhum plantão de {alvo.nome} em {body.data_plantao}.")
            plantao_id_final = plantao_buscado.id
        if not plantao_id_final:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o plantão vinculado (ou a data em que ele foi realizado).")

        plantao = db.get(Plantao, plantao_id_final)
        if not plantao or plantao.colaborador_id != alvo.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado para este colaborador.")
        ja_tem = db.query(SolicitacaoFolga).filter(SolicitacaoFolga.plantao_id == plantao_id_final).first()
        if ja_tem:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esse plantão já tem uma folga solicitada.")

        prazo = prazo_folga_plantao(db, plantao.data)
        if body.data_solicitada > prazo or body.data_solicitada <= plantao.data:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"A data da folga deve estar entre o dia seguinte ao plantão e {prazo.strftime('%d/%m/%Y')} (prazo estendido até o domingo da semana seguinte quando o plantão foi num feriado).")
        ok, motivo = dia_util_para_folga(db, body.data_solicitada)
        if not ok:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo)

    if body.tipo == "folga_sindicato":
        cota = identificar_cota_sindicato(body.data_solicitada)
        if not cota:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Essa data não está dentro de nenhuma janela de folga sindicato (Maio, Agosto, Outubro ou Dezembro).")
        resumo = resumo_cotas_sindicato(db, alvo.id, cota["ciclo"])
        cota_info = next(c for c in resumo["cotas"] if c["nome"] == cota["nome"])
        if cota_info["usada"]:
            raise HTTPException(status.HTTP_409_CONFLICT, f"A folga sindicato da janela '{cota['nome']}' já foi usada nesse ciclo (são 4 por ano, uma por janela).")
        ok, motivo = dia_util_para_folga(db, body.data_solicitada)
        if not ok:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo)

    colegas = db.query(Colaborador).filter(Colaborador.id != alvo.id).all()
    colegas_similares_ids = {
        c.id for c in colegas
        if horarios_similares(alvo.horario_inicio, alvo.horario_fim, c.horario_inicio, c.horario_fim)
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
            f"{nome_colega}, com horário igual ou parecido, já tem folga "
            f"{'aprovada' if conflito.status == 'aprovada' else 'solicitada'} nessa data. "
            "Envie novamente com 'ignorar_aviso' para confirmar mesmo assim.",
        )

    status_inicial = "aprovada" if registrando_para_outro else "pendente"
    nova = SolicitacaoFolga(
        colaborador_id=alvo.id, tipo=body.tipo, plantao_id=plantao_id_final,
        data_solicitada=body.data_solicitada, status=status_inicial,
    )
    if status_inicial == "aprovada":
        nova.resolved_by = user.id
        nova.resolved_at = datetime.utcnow()
    db.add(nova)
    db.commit()
    db.refresh(nova)
    log_action(db, request, user, "solicitar_folga", "solicitacao_folga", nova.id)
    return nova


@router.post("/{solicitacao_id}/reabrir", response_model=SolicitacaoOut)
def reabrir(solicitacao_id: str, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    """Volta uma solicitação já aprovada/rejeitada para 'pendente', pra permitir
    corrigir uma decisão (ex: aprovou por engano, precisa cancelar)."""
    alvo = db.get(SolicitacaoFolga, solicitacao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitação não encontrada.")
    dono = db.get(Colaborador, alvo.colaborador_id)
    if dono:
        check_escopo_equipe(user, dono.equipe)
    if alvo.status == "pendente":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Essa solicitação já está pendente.")
    alvo.status = "pendente"
    alvo.motivo_rejeicao = None
    alvo.resolved_by = None
    alvo.resolved_at = None
    db.commit()
    log_action(db, request, user, "reabrir_folga", "solicitacao_folga", alvo.id)
    return alvo


@router.post("/{solicitacao_id}/resolver", response_model=SolicitacaoOut)
def resolver(solicitacao_id: str, body: ResolverSolicitacaoIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(SolicitacaoFolga, solicitacao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitação não encontrada.")
    dono = db.get(Colaborador, alvo.colaborador_id)
    if dono:
        check_escopo_equipe(user, dono.equipe)
    if alvo.status != "pendente":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Essa solicitação já foi resolvida.")

    if not body.aprovar and not (body.motivo_rejeicao and body.motivo_rejeicao.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o motivo da rejeição.")

    alvo.status = "aprovada" if body.aprovar else "rejeitada"
    alvo.motivo_rejeicao = body.motivo_rejeicao if not body.aprovar else None
    alvo.resolved_by = user.id
    alvo.resolved_at = datetime.utcnow()
    db.commit()
    log_action(db, request, user, "resolver_folga", "solicitacao_folga", alvo.id, {"aprovado": body.aprovar})
    return alvo
