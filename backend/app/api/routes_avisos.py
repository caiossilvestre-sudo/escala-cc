from datetime import date as date_type, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_colaborador, log_action, require_admin
from app.core.email import enviar_email_aviso, smtp_configurado
from app.db.models import Atestado, Aviso, Colaborador, Configuracao, Feriado, Ferias, Plantao, SolicitacaoFolga
from app.db.session import get_db
from app.logic import ciclo_ferias, prazo_folga_plantao
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
    cobrança de folga, aniversário natalício, aniversário de empresa e
    lembrete mensal de férias (faltando 4 meses ou menos pro fim do ciclo).

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

    # Lembrete mensal de férias: faltam 4 meses ou menos pro fim do prazo do
    # ciclo (período concessivo) e ainda há dias sem tirar nem agendar.
    primeiro_do_mes = data_ref.replace(day=1)
    for c in colaboradores:
        if c.role not in ("colaborador", "supervisor"):
            continue
        ferias_da_pessoa = db.query(Ferias).filter(Ferias.colaborador_id == c.id).all()
        ciclo = ciclo_ferias(c.data_admissao, ferias_da_pessoa, data_ref)
        if not ciclo or not ciclo["alerta"]:
            continue
        ja_avisado = db.query(Aviso).filter(Aviso.tipo == "ferias_ciclo", Aviso.colaborador_id == c.id, Aviso.data >= primeiro_do_mes, Aviso.data <= data_ref).first()
        if forcar or not ja_avisado:
            novos.append(Aviso(colaborador_id=c.id, tipo="ferias_ciclo", data=data_ref, canais=["painel"],
                                mensagem=f"Atenção: seu prazo para tirar férias termina em {ciclo['fim'].strftime('%d/%m/%Y')} e você ainda tem {ciclo['restam']} dia(s) sem agendar. Solicite em 'Minhas férias' o quanto antes."))

    for n in novos:
        db.add(n)
    db.commit()

    # Tenta enviar cada aviso novo por e-mail também (só se SMTP estiver
    # configurado — senão fica só no painel, sem quebrar nada). O Teams não
    # entra aqui: quem "empurra" pro Teams é o próprio Power Automate, que
    # vem buscar os avisos pendentes via /avisos/pendentes-teams.
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


def _verificar_chave_teams(x_api_key: str = Header(default="")):
    """Autenticação simples (chave compartilhada) pro Power Automate consultar
    os avisos pendentes — não usa login/JWT porque quem chama é um fluxo
    automatizado, não uma pessoa logada no sistema."""
    if not settings.teams_api_key or x_api_key != settings.teams_api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave de acesso inválida.")


FUSO_LOCAL = ZoneInfo("America/Sao_Paulo")
ANTECEDENCIA_INTERVALO_MIN = 15      # avisa até 15 min antes do intervalo começar
VALIDADE_LEMBRETE_INTERVALO_MIN = 30  # lembrete que ficou parado mais que isso não é mais enviado


def _min_do_dia(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def _dentro(ini_min: int, inicio: str, fim: str) -> bool:
    """O minuto `ini_min` cai dentro de [inicio, fim]? Cobre turno que vira a noite."""
    a, b = _min_do_dia(inicio), _min_do_dia(fim)
    return a <= ini_min <= b if a <= b else (ini_min >= a or ini_min <= b)


def _esta_de_servico(db: Session, c: Colaborador, dia: date_type, ini_min: int) -> bool:
    """A pessoa está trabalhando na hora em que o intervalo começa? Espelha a
    regra do Dashboard ("Quem está em expediente agora"): plantão do dia (ou da
    madrugada de ontem) manda; senão 12x36 do Monitoramento; domingo/feriado só
    com plantão; no resto, o horário normal. Folga aprovada, atestado e férias
    no dia cancelam o lembrete."""
    if db.query(SolicitacaoFolga).filter(SolicitacaoFolga.colaborador_id == c.id, SolicitacaoFolga.status == "aprovada", SolicitacaoFolga.data_solicitada == dia).first():
        return False
    if db.query(Atestado).filter(Atestado.colaborador_id == c.id, Atestado.data_inicio <= dia, Atestado.data_fim >= dia).first():
        return False
    if db.query(Ferias).filter(Ferias.colaborador_id == c.id, Ferias.status == "aprovada", Ferias.data_inicio <= dia, Ferias.data_fim >= dia).first():
        return False

    ontem = dia - timedelta(days=1)
    plantao_hoje = db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data == dia).all()
    plantao_ontem = db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data == ontem).all()
    for p in plantao_ontem:
        if p.horario_fim < p.horario_inicio and ini_min <= _min_do_dia(p.horario_fim):
            return True  # madrugada de um plantão que começou ontem
    for p in plantao_hoje:
        cruza = p.horario_fim < p.horario_inicio
        if (ini_min >= _min_do_dia(p.horario_inicio)) if cruza else _dentro(ini_min, p.horario_inicio, p.horario_fim):
            return True
    if plantao_hoje:
        return False

    if c.equipe == "Monitoramento" and c.escala_tipo == "12x36" and c.ciclo_12x36_inicio:
        cruza = c.horario_fim < c.horario_inicio
        if cruza and ini_min <= _min_do_dia(c.horario_fim) and ontem >= c.ciclo_12x36_inicio and (ontem - c.ciclo_12x36_inicio).days % 2 == 0:
            return True
        if dia >= c.ciclo_12x36_inicio and (dia - c.ciclo_12x36_inicio).days % 2 == 0:
            return ini_min >= _min_do_dia(c.horario_inicio) if cruza else _dentro(ini_min, c.horario_inicio, c.horario_fim)
        return False

    feriado = db.query(Feriado).filter(Feriado.data == dia).all()
    if dia.weekday() == 6 or any(f.tipo == "obrigatorio" or f.trabalha for f in feriado):
        return False  # domingo/feriado: só quem tem plantão (tratado acima)
    return _dentro(ini_min, c.horario_inicio, c.horario_fim)


def gerar_lembretes_intervalo(db: Session, agora: datetime | None = None) -> int:
    """Cria o aviso "intervalo" de quem tem o intervalo começando nos próximos
    15 minutos (uma vez por pessoa/dia). Não depende de ninguém clicar em nada:
    roda sempre que o Power Automate consulta os pendentes — por isso o fluxo
    precisa consultar com frequência (a cada 5 min). O aviso nasce já como
    "lido" (não vira pop-up nem pendência no painel); só serve de mensagem pro Teams."""
    agora = agora or datetime.now(FUSO_LOCAL)
    agora_min = agora.hour * 60 + agora.minute
    hoje = agora.date()
    criados = 0
    candidatos = db.query(Colaborador).filter(
        Colaborador.status == "ativo", Colaborador.role.in_(("colaborador", "supervisor")),
        Colaborador.intervalo_inicio.isnot(None), Colaborador.intervalo_fim.isnot(None),
    ).all()
    for c in candidatos:
        ini_min = _min_do_dia(c.intervalo_inicio)
        falta = (ini_min - agora_min) % 1440
        if falta > ANTECEDENCIA_INTERVALO_MIN:
            continue
        dia = hoje if ini_min >= agora_min else hoje + timedelta(days=1)  # virou a meia-noite
        if db.query(Aviso).filter(Aviso.colaborador_id == c.id, Aviso.tipo == "intervalo", Aviso.data == dia).first():
            continue
        if not _esta_de_servico(db, c, dia, ini_min):
            continue
        db.add(Aviso(
            colaborador_id=c.id, tipo="intervalo", data=dia, canais=[], lido=True, lido_via="automatico", lido_em=datetime.utcnow(),
            mensagem=f"⏰ Lembrete: seu intervalo começa às {c.intervalo_inicio} (vai até {c.intervalo_fim}).",
        ))
        criados += 1
    if criados:
        db.commit()
    return criados


@router.get("/pendentes-teams")
def pendentes_teams(db: Session = Depends(get_db), _: None = Depends(_verificar_chave_teams)):
    """O Power Automate chama isso periodicamente (a cada 5 min, por causa do
    lembrete de intervalo) pra buscar avisos que ainda não foram mandados pro
    Teams — em vez do nosso sistema tentar chamar o Power Automate direto, o
    que exigiria OAuth."""
    gerar_lembretes_intervalo(db)
    pendentes = db.query(Aviso).filter(Aviso.teams_enviado.isnot(True)).all()
    resultado = []
    limite = datetime.utcnow() - timedelta(minutes=VALIDADE_LEMBRETE_INTERVALO_MIN)
    for a in pendentes:
        if a.tipo == "intervalo" and a.created_at and a.created_at < limite:
            # fluxo ficou parado: lembrete de intervalo atrasado não faz sentido, descarta
            a.teams_enviado = True
            a.teams_erro = "expirado: não enviado (ficou pendente por mais de 30 min)"
            db.commit()
            continue
        colaborador = db.get(Colaborador, a.colaborador_id)
        if not colaborador:
            continue
        resultado.append({
            "aviso_id": a.id,
            "email_destinatario": colaborador.email,
            "nome": colaborador.nome,
            "tipo": a.tipo,
            "mensagem": a.mensagem,
        })
    return resultado


@router.post("/{aviso_id}/marcar-teams-enviado")
def marcar_teams_enviado(aviso_id: str, db: Session = Depends(get_db), _: None = Depends(_verificar_chave_teams)):
    """O Power Automate chama isso depois de mandar a mensagem com sucesso,
    pra esse aviso não ser buscado de novo na próxima consulta."""
    alvo = db.get(Aviso, aviso_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aviso não encontrado.")
    alvo.teams_enviado = True
    alvo.teams_erro = None
    if "teams" not in alvo.canais:
        alvo.canais = alvo.canais + ["teams"]
    db.commit()
    return {"ok": True}
