from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import check_escopo_equipe, get_current_colaborador, log_action, require_admin_or_supervisor
from app.db.models import Colaborador, Plantao, PlantaoTemplate, SolicitacaoFolga
from app.db.session import get_db
from app.logic import checar_elegibilidade, datas_alvo_do_mes, ordenar_por_justica
from app.schemas import GerarPlantoesIn, PlantaoIn, PlantaoOut, PlantaoTemplateIn, PlantaoTemplateOut

router = APIRouter(prefix="/plantoes", tags=["plantoes"])
templates_router = APIRouter(prefix="/plantao-templates", tags=["plantao-templates"])


@router.get("", response_model=list[PlantaoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Plantao)
    if user.role == "colaborador":
        q = q.filter(Plantao.sugerido == False)  # noqa: E712
    if user.role == "supervisor":
        ids_equipe = [c.id for c in db.query(Colaborador.id).filter(Colaborador.equipe == user.equipe)]
        q = q.filter(Plantao.colaborador_id.in_(ids_equipe))
    return q.order_by(Plantao.data).all()


@router.post("", response_model=PlantaoOut, status_code=status.HTTP_201_CREATED)
def criar(body: PlantaoIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Colaborador, body.colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    check_escopo_equipe(user, alvo.equipe)
    novo = Plantao(
        colaborador_id=body.colaborador_id, data=body.data,
        horario_inicio=body.horario_inicio, horario_fim=body.horario_fim,
        tipo=body.tipo, template_id=body.template_id, origem="manual", sugerido=False,
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, user, "criar_plantao", "plantao", novo.id)
    return novo


@router.delete("/{plantao_id}")
def remover(plantao_id: str, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Plantao, plantao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado.")
    dono = db.get(Colaborador, alvo.colaborador_id)
    if dono:
        check_escopo_equipe(user, dono.equipe)
    # Se já existe uma folga vinculada a esse plantão, ela referencia o
    # plantao_id — sem desvincular primeiro, o banco recusa apagar o plantão
    # (violação de integridade). A folga em si continua existindo no
    # histórico, só perde a referência ao plantão que foi removido.
    db.query(SolicitacaoFolga).filter(SolicitacaoFolga.plantao_id == plantao_id).update({"plantao_id": None})
    db.delete(alvo)
    db.commit()
    log_action(db, request, user, "remover_plantao", "plantao", plantao_id)
    return {"ok": True}


@router.post("/{plantao_id}/confirmar", response_model=PlantaoOut)
def confirmar(plantao_id: str, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Plantao, plantao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado.")
    dono = db.get(Colaborador, alvo.colaborador_id)
    if dono:
        check_escopo_equipe(user, dono.equipe)
    alvo.sugerido = False
    db.commit()
    log_action(db, request, user, "confirmar_plantao", "plantao", plantao_id)
    return alvo


@router.post("/{plantao_id}/reatribuir", response_model=PlantaoOut)
def reatribuir(plantao_id: str, novo_colaborador_id: str, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(Plantao, plantao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado.")
    novo_colaborador = db.get(Colaborador, novo_colaborador_id)
    if not novo_colaborador:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    dono_atual = db.get(Colaborador, alvo.colaborador_id)
    if dono_atual:
        check_escopo_equipe(user, dono_atual.equipe)
    check_escopo_equipe(user, novo_colaborador.equipe)
    alvo.colaborador_id = novo_colaborador_id
    db.commit()
    log_action(db, request, user, "reatribuir_plantao", "plantao", plantao_id)
    return alvo


@router.post("/gerar")
def gerar(body: GerarPlantoesIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvos = datas_alvo_do_mes(db, body.mes)
    templates_query = db.query(PlantaoTemplate)
    colaboradores_query = db.query(Colaborador).filter(Colaborador.status == "ativo", Colaborador.role != "admin")
    if user.role == "supervisor":
        templates_query = templates_query.filter(PlantaoTemplate.equipe == user.equipe)
        colaboradores_query = colaboradores_query.filter(Colaborador.equipe == user.equipe)
    templates = templates_query.all()
    colaboradores = colaboradores_query.all()

    novos = []
    pendencias = []

    for alvo in alvos:
        data_alvo, label = alvo["data"], alvo["label"]
        for tpl in templates:
            ja_existe = db.query(Plantao).filter(Plantao.template_id == tpl.id, Plantao.data == data_alvo).first()
            if ja_existe:
                continue
            elegiveis = []
            for c in colaboradores:
                ok, _ = checar_elegibilidade(db, c, tpl.equipe, data_alvo, tpl.horario_inicio, tpl.horario_fim)
                if ok:
                    elegiveis.append(c)
            ordenados = ordenar_por_justica(db, elegiveis, data_alvo)
            if ordenados:
                escolhido = ordenados[0]
                novo = Plantao(
                    colaborador_id=escolhido.id, data=data_alvo,
                    horario_inicio=tpl.horario_inicio, horario_fim=tpl.horario_fim,
                    tipo=f"{tpl.nome} — {label}", template_id=tpl.id,
                    origem="auto", sugerido=True,
                )
                db.add(novo)
                novos.append(novo)
            else:
                pendencias.append({"data": str(data_alvo), "label": label, "template": tpl.nome})

    db.commit()
    log_action(db, request, user, "gerar_plantoes", "plantao", None, {"mes": body.mes, "criados": len(novos)})
    return {
        "novos": [PlantaoOut.model_validate(n).model_dump() for n in novos],
        "pendencias": pendencias,
    }


# --- horários de plantão disponíveis (templates) ---

@templates_router.get("", response_model=list[PlantaoTemplateOut])
def listar_templates(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(PlantaoTemplate)
    if user.role == "supervisor":
        q = q.filter(PlantaoTemplate.equipe == user.equipe)
    return q.all()


@templates_router.post("", response_model=PlantaoTemplateOut, status_code=status.HTTP_201_CREATED)
def criar_template(body: PlantaoTemplateIn, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    check_escopo_equipe(user, body.equipe)
    novo = PlantaoTemplate(**body.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, user, "criar_template", "plantao_template", novo.id)
    return novo


@templates_router.delete("/{template_id}")
def remover_template(template_id: str, request: Request, db: Session = Depends(get_db), user: Colaborador = Depends(require_admin_or_supervisor)):
    alvo = db.get(PlantaoTemplate, template_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Horário não encontrado.")
    check_escopo_equipe(user, alvo.equipe)
    db.delete(alvo)
    db.commit()
    log_action(db, request, user, "remover_template", "plantao_template", template_id)
    return {"ok": True}
