from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin
from app.db.models import Colaborador, Plantao, PlantaoTemplate
from app.db.session import get_db
from app.logic import checar_elegibilidade, datas_alvo_do_mes, ordenar_por_justica
from app.schemas import GerarPlantoesIn, PlantaoIn, PlantaoOut, PlantaoTemplateIn, PlantaoTemplateOut

router = APIRouter(prefix="/plantoes", tags=["plantoes"])
templates_router = APIRouter(prefix="/plantao-templates", tags=["plantao-templates"])


@router.get("", response_model=list[PlantaoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Plantao)
    if user.role != "admin":
        # Plantões ainda "sugeridos" (gerados automaticamente, aguardando confirmação
        # do admin) não aparecem pros colaboradores — só depois de confirmados.
        q = q.filter(Plantao.sugerido == False)  # noqa: E712
    return q.order_by(Plantao.data).all()


@router.post("", response_model=PlantaoOut, status_code=status.HTTP_201_CREATED)
def criar(body: PlantaoIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Colaborador, body.colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    novo = Plantao(
        colaborador_id=body.colaborador_id, data=body.data,
        horario_inicio=body.horario_inicio, horario_fim=body.horario_fim,
        tipo=body.tipo, template_id=body.template_id, origem="manual", sugerido=False,
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, admin, "criar_plantao", "plantao", novo.id)
    return novo


@router.delete("/{plantao_id}")
def remover(plantao_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Plantao, plantao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado.")
    db.delete(alvo)
    db.commit()
    log_action(db, request, admin, "remover_plantao", "plantao", plantao_id)
    return {"ok": True}


@router.post("/{plantao_id}/confirmar", response_model=PlantaoOut)
def confirmar(plantao_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Plantao, plantao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado.")
    alvo.sugerido = False
    db.commit()
    log_action(db, request, admin, "confirmar_plantao", "plantao", plantao_id)
    return alvo


@router.post("/{plantao_id}/reatribuir", response_model=PlantaoOut)
def reatribuir(plantao_id: str, novo_colaborador_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Plantao, plantao_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantão não encontrado.")
    if not db.get(Colaborador, novo_colaborador_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    alvo.colaborador_id = novo_colaborador_id
    db.commit()
    log_action(db, request, admin, "reatribuir_plantao", "plantao", plantao_id)
    return alvo


@router.post("/gerar")
def gerar(body: GerarPlantoesIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvos = datas_alvo_do_mes(db, body.mes)
    templates = db.query(PlantaoTemplate).all()
    colaboradores = db.query(Colaborador).filter(Colaborador.status == "ativo", Colaborador.role != "admin").all()

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
    log_action(db, request, admin, "gerar_plantoes", "plantao", None, {"mes": body.mes, "criados": len(novos)})
    return {
        "novos": [PlantaoOut.model_validate(n).model_dump() for n in novos],
        "pendencias": pendencias,
    }


# --- horários de plantão disponíveis (templates) ---

@templates_router.get("", response_model=list[PlantaoTemplateOut])
def listar_templates(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    return db.query(PlantaoTemplate).all()


@templates_router.post("", response_model=PlantaoTemplateOut, status_code=status.HTTP_201_CREATED)
def criar_template(body: PlantaoTemplateIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    novo = PlantaoTemplate(**body.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, admin, "criar_template", "plantao_template", novo.id)
    return novo


@templates_router.delete("/{template_id}")
def remover_template(template_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(PlantaoTemplate, template_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Horário não encontrado.")
    db.delete(alvo)
    db.commit()
    log_action(db, request, admin, "remover_template", "plantao_template", template_id)
    return {"ok": True}
