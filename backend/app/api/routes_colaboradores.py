from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin, require_leitura_ampla
from app.core.security import hash_password
from app.db.models import Colaborador, HistoricoEquipe, Plantao, SolicitacaoFolga, Ferias
from app.db.session import get_db
from app.schemas import (
    ColaboradorIn, ColaboradorOut, ColaboradorUpdateIn, DesligarIn, HistoricoEquipeOut, ResetarSenhaIn,
)

router = APIRouter(prefix="/colaboradores", tags=["colaboradores"])


@router.get("", response_model=list[ColaboradorOut])
def listar(incluir_inativos: bool = False, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    q = db.query(Colaborador)
    if not incluir_inativos:
        q = q.filter(Colaborador.status == "ativo")
    if user.role == "supervisor":
        q = q.filter(Colaborador.equipe == user.equipe)
    return q.all()


@router.get("/me", response_model=ColaboradorOut)
def eu(user: Colaborador = Depends(get_current_colaborador)):
    return user


@router.post("", response_model=ColaboradorOut, status_code=status.HTTP_201_CREATED)
def criar(body: ColaboradorIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    existente = db.query(Colaborador).filter(Colaborador.email == body.email.lower()).first()
    if existente:
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um colaborador com esse e-mail.")

    novo = Colaborador(
        nome=body.nome, email=body.email.lower(), role=body.role,
        equipe=body.equipe, turno=body.turno, escala_tipo=body.escala_tipo,
        horario_inicio=body.horario_inicio, horario_fim=body.horario_fim,
        password_hash=hash_password(body.senha_inicial),
        must_change_password=True,
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    log_action(db, request, admin, "criar_colaborador", "colaborador", novo.id, {"nome": novo.nome})
    return novo


@router.patch("/{colaborador_id}", response_model=ColaboradorOut)
def atualizar(colaborador_id: str, body: ColaboradorUpdateIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    """Edita um colaborador já existente: nome, perfil (admin/colaborador/
    visualizador), equipe, turno, escala ou horário. Toda mudança de equipe
    ou turno fica registrada no histórico (com motivo obrigatório)."""
    alvo = db.get(Colaborador, colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")

    if body.role is not None and body.role != alvo.role and alvo.role == "admin" and body.role != "admin":
        outros_admins = db.query(Colaborador).filter(Colaborador.role == "admin", Colaborador.status == "ativo", Colaborador.id != alvo.id).count()
        if outros_admins == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não é possível rebaixar o único administrador ativo do sistema.")

    equipe_mudou = body.equipe is not None and body.equipe != alvo.equipe
    turno_mudou = body.turno is not None and body.turno != alvo.turno

    if equipe_mudou or turno_mudou:
        db.add(HistoricoEquipe(
            colaborador_id=alvo.id,
            equipe_anterior=alvo.equipe, equipe_nova=body.equipe or alvo.equipe,
            turno_anterior=alvo.turno, turno_novo=body.turno or alvo.turno,
            motivo=body.motivo, alterado_por=admin.id,
        ))

    if body.nome is not None:
        alvo.nome = body.nome
    if body.role is not None:
        alvo.role = body.role
    if body.equipe is not None:
        alvo.equipe = body.equipe
    if body.turno is not None:
        alvo.turno = body.turno
    if body.escala_tipo is not None:
        alvo.escala_tipo = body.escala_tipo
    if body.horario_inicio is not None:
        alvo.horario_inicio = body.horario_inicio
    if body.horario_fim is not None:
        alvo.horario_fim = body.horario_fim

    db.commit()
    db.refresh(alvo)
    log_action(db, request, admin, "atualizar_colaborador", "colaborador", alvo.id, {"motivo": body.motivo, "role": body.role})
    return alvo


@router.post("/{colaborador_id}/resetar-senha", response_model=ColaboradorOut)
def resetar_senha(colaborador_id: str, body: ResetarSenhaIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    """Define uma nova senha provisória pro colaborador (ele precisa trocar no
    próximo login) e já libera qualquer bloqueio por tentativas erradas."""
    alvo = db.get(Colaborador, colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    alvo.password_hash = hash_password(body.nova_senha)
    alvo.must_change_password = True
    alvo.failed_attempts = 0
    alvo.locked_until = None
    db.commit()
    db.refresh(alvo)
    log_action(db, request, admin, "resetar_senha", "colaborador", alvo.id)
    return alvo


@router.post("/{colaborador_id}/desbloquear", response_model=ColaboradorOut)
def desbloquear(colaborador_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    """Libera o bloqueio por tentativas de login erradas, sem mexer na senha."""
    alvo = db.get(Colaborador, colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    alvo.failed_attempts = 0
    alvo.locked_until = None
    db.commit()
    db.refresh(alvo)
    log_action(db, request, admin, "desbloquear_colaborador", "colaborador", alvo.id)
    return alvo


@router.get("/{colaborador_id}/historico-equipe", response_model=list[HistoricoEquipeOut])
def historico_equipe(colaborador_id: str, db: Session = Depends(get_db), user: Colaborador = Depends(require_leitura_ampla)):
    return (
        db.query(HistoricoEquipe)
        .filter(HistoricoEquipe.colaborador_id == colaborador_id)
        .order_by(HistoricoEquipe.created_at.desc())
        .all()
    )


@router.post("/{colaborador_id}/desligar", response_model=ColaboradorOut)
def desligar(colaborador_id: str, body: DesligarIn, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    """Desligamento é sempre um soft-delete: o colaborador vira 'inativo' e some
    das listas de cadastro/atribuição automática, mas todo o histórico dele
    (plantões, folgas, atestados, férias já registrados) continua intacto para
    relatórios e auditoria — nada é apagado."""
    alvo = db.get(Colaborador, colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    if alvo.role == "admin":
        outros_admins = db.query(Colaborador).filter(Colaborador.role == "admin", Colaborador.status == "ativo", Colaborador.id != alvo.id).count()
        if outros_admins == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não é possível desligar o único administrador ativo do sistema.")

    alvo.status = "inativo"
    alvo.data_desligamento = date.today()
    alvo.motivo_desligamento = body.motivo
    db.commit()
    db.refresh(alvo)

    plantoes_futuros = (
        db.query(Plantao)
        .filter(Plantao.colaborador_id == alvo.id, Plantao.data >= date.today())
        .order_by(Plantao.data)
        .all()
    )

    log_action(db, request, admin, "desligar_colaborador", "colaborador", alvo.id, {
        "motivo": body.motivo,
        "plantoes_futuros_pendentes": len(plantoes_futuros),
    })

    return ColaboradorOut.model_validate(alvo)


@router.get("/{colaborador_id}/pendencias-desligamento")
def pendencias_desligamento(colaborador_id: str, db: Session = Depends(get_db), user: Colaborador = Depends(require_leitura_ampla)):
    plantoes_futuros = (
        db.query(Plantao)
        .filter(Plantao.colaborador_id == colaborador_id, Plantao.data >= date.today())
        .order_by(Plantao.data)
        .all()
    )
    folgas_pendentes = (
        db.query(SolicitacaoFolga)
        .filter(SolicitacaoFolga.colaborador_id == colaborador_id, SolicitacaoFolga.status == "pendente")
        .all()
    )
    ferias_em_andamento = (
        db.query(Ferias)
        .filter(Ferias.colaborador_id == colaborador_id, Ferias.status.in_(["solicitada", "enviado_rh"]))
        .all()
    )
    return {
        "plantoes_futuros": [{"id": p.id, "data": str(p.data), "horario": f"{p.horario_inicio}-{p.horario_fim}", "tipo": p.tipo} for p in plantoes_futuros],
        "folgas_pendentes": len(folgas_pendentes),
        "ferias_em_andamento": len(ferias_em_andamento),
    }


@router.post("/{colaborador_id}/reativar", response_model=ColaboradorOut)
def reativar(colaborador_id: str, request: Request, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    alvo = db.get(Colaborador, colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    alvo.status = "ativo"
    alvo.data_desligamento = None
    alvo.motivo_desligamento = None
    db.commit()
    log_action(db, request, admin, "reativar_colaborador", "colaborador", alvo.id)
    return alvo
