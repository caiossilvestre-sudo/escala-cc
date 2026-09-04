from datetime import date as date_type, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action, require_admin
from app.core.email import enviar_email_aviso, smtp_configurado
from app.db.models import Aviso, Colaborador, Configuracao, Plantao, SolicitacaoFolga
from app.db.session import get_db
from app.logic import prazo_folga_plantao
from app.schemas import AvisoOut

router = APIRouter(prefix="/avisos", tags=["avisos"])

VEZES_PARA_CONSIDERAR_LIDO = 3  # mostrado 3x sem a pessoa marcar como lido = considera lido sozinho

MENSAGENS_PADRAO = {
    "mensagem_aniversario": "🎉 Feliz aniversário, {nome}! Toda a equipe deseja um dia incrível. 🎂",
    "mensagem_aniversario_trabalho": "🎊 Parabéns pelos {anos} ano(s) de casa, {nome}! Obrigado pela dedicação todos esses anos.",
}


def _mensagem_configurada(db: Session, chave: str) -> str:
    cfg = db.get(Configuracao, chave)
    return cfg.valor if cfg else MENSAGENS_PADRAO.get(chave, "")


@router.get("", response_model=list[AvisoOut])
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    """Admin vê todos os avisos (pra acompanhar quem leu o quê). Todo mundo
    mais só vê os próprios."""
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
    alvo.lido_em = datetime.utcnow()
    alvo.lido_via = "manual"
    db.commit()
    return alvo


@router.post("/{aviso_id}/marcar-exibido", response_model=AvisoOut)
def marcar_exibido(aviso_id: str, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    """Chamado pelo popup toda vez que o aviso é de fato mostrado pra pessoa.
    Depois de mostrado 3 vezes sem a pessoa marcar como lido manualmente, o
    sistema considera lido sozinho e para de mostrar de novo."""
    alvo = db.get(Aviso, aviso_id)
    if not alvo or alvo.colaborador_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aviso não encontrado.")
    alvo.vezes_mostrado = (alvo.vezes_mostrado or 0) + 1
    if alvo.vezes_mostrado >= VEZES_PARA_CONSIDERAR_LIDO:
        alvo.lido = True
        alvo.lido_em = datetime.utcnow()
        alvo.lido_via = "automatico"
    db.commit()
    db.refresh(alvo)
    return alvo


DIAS_SEMANA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def _listar_plantoes(plantoes: list[Plantao]) -> str:
    linhas = []
    for p in sorted(plantoes, key=lambda x: x.data):
        dia_semana = DIAS_SEMANA[p.data.weekday()]
        linhas.append(f"Dia {p.data.strftime('%d/%m')} ({dia_semana}), das {p.horario_inicio} às {p.horario_fim}")
    return "\n".join(linhas)


@router.post("/gerar")
def gerar(data_ref: date_type, request: Request, forcar: bool = False, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    """Roda as regras diárias: lista mensal (dia 1), aviso semanal (segunda),
    cobrança de folga, aniversário natalício e aniversário de empresa.

    Com forcar=True, ignora a checagem de "já foi avisado" e gera de novo mesmo
    que já exista um aviso equivalente. Em produção, chame esse endpoint uma
    vez por dia via um agendador (cron / GitHub Actions / APScheduler).
    """
    novos = []
    colaboradores = db.query(Colaborador).filter(Colaborador.status == "ativo").all()

    if data_ref.day == 1:
        for c in colaboradores:
            ja_existe = db.query(Aviso).filter(Aviso.colaborador_id == c.id, Aviso.tipo == "mensal", Aviso.data == data_ref).first()
            plantoes_mes = db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data >= data_ref.replace(day=1)).filter(Plantao.data < (data_ref.replace(day=28) + timedelta(days=4)).replace(day=1)).all()
            if (forcar or not ja_existe) and plantoes_mes:
                novos.append(Aviso(colaborador_id=c.id, tipo="mensal", data=data_ref, canais=["painel"],
                                    mensagem=f"Você tem {len(plantoes_mes)} plantão(ões) este mês:\n{_listar_plantoes(plantoes_mes)}"))

    if data_ref.weekday() == 0:  # segunda-feira
        semana_fim = data_ref + timedelta(days=6)
        for c in colaboradores:
            ja_existe = db.query(Aviso).filter(Aviso.colaborador_id == c.id, Aviso.tipo == "semanal", Aviso.data == data_ref).first()
            plantoes_semana = db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data >= data_ref, Plantao.data <= semana_fim).all()
            if (forcar or not ja_existe) and plantoes_semana:
                novos.append(Aviso(colaborador_id=c.id, tipo="semanal", data=data_ref, canais=["painel"],
                                    mensagem=f"Esta semana você tem {len(plantoes_semana)} plantão(ões):\n{_listar_plantoes(plantoes_semana)}"))

    plantoes_todos = db.query(Plantao).all()
    for p in plantoes_todos:
        prazo = prazo_folga_plantao(db, p.data)
        if data_ref > prazo:
            tem_solicitacao = db.query(SolicitacaoFolga).filter(SolicitacaoFolga.plantao_id == p.id, SolicitacaoFolga.status != "rejeitada").first()
            ja_avisado = db.query(Aviso).filter(Aviso.tipo == "cobranca", Aviso.colaborador_id == p.colaborador_id, Aviso.data == data_ref).first()
            if not tem_solicitacao and (forcar or not ja_avisado):
                novos.append(Aviso(colaborador_id=p.colaborador_id, tipo="cobranca", data=data_ref, canais=["painel"],
                                    mensagem=f"Pendente: agende a folga do plantão de {p.data.strftime('%d/%m/%Y')} ({DIAS_SEMANA[p.data.weekday()]}) — prazo era {prazo.strftime('%d/%m/%Y')} ({DIAS_SEMANA[prazo.weekday()]})."))

    # Aniversário natalício
    texto_aniversario = _mensagem_configurada(db, "mensagem_aniversario")
    for c in colaboradores:
        if c.data_aniversario and c.data_aniversario.month == data_ref.month and c.data_aniversario.day == data_ref.day:
            ja_avisado = db.query(Aviso).filter(Aviso.tipo == "aniversario", Aviso.colaborador_id == c.id, Aviso.data == data_ref).first()
            if forcar or not ja_avisado:
                novos.append(Aviso(colaborador_id=c.id, tipo="aniversario", data=data_ref, canais=["painel"],
                                    mensagem=texto_aniversario.replace("{nome}", c.nome.split(" ")[0])))

    # Aniversário de empresa (tempo de casa) — só a partir de 1 ano completo
    texto_trabalho = _mensagem_configurada(db, "mensagem_aniversario_trabalho")
    for c in colaboradores:
        if c.data_admissao and c.data_admissao.month == data_ref.month and c.data_admissao.day == data_ref.day:
            anos = data_ref.year - c.data_admissao.year
            if anos >= 1:
                ja_avisado = db.query(Aviso).filter(Aviso.tipo == "aniversario_trabalho", Aviso.colaborador_id == c.id, Aviso.data == data_ref).first()
                if forcar or not ja_avisado:
                    texto = texto_trabalho.replace("{nome}", c.nome.split(" ")[0]).replace("{anos}", str(anos))
                    novos.append(Aviso(colaborador_id=c.id, tipo="aniversario_trabalho", data=data_ref, canais=["painel"], mensagem=texto))

    for n in novos:
        db.add(n)
    db.commit()

    # Tenta enviar cada aviso novo por e-mail também (só se SMTP estiver
    # configurado — senão fica só no painel, sem quebrar nada).
    if smtp_configurado():
        colaboradores_por_id = {c.id: c for c in colaboradores}
        for n in novos:
            alvo = colaboradores_por_id.get(n.colaborador_id)
            if not alvo:
                continue
            sucesso, erro = enviar_email_aviso(alvo.email, n.tipo, n.mensagem)
            n.email_enviado = sucesso
            n.email_erro = erro
            if sucesso and "email" not in n.canais:
                n.canais = n.canais + ["email"]
        db.commit()

    log_action(db, request, admin, "gerar_avisos", "aviso", None, {"quantidade": len(novos), "forcar": forcar})
    return {"gerados": len(novos)}
