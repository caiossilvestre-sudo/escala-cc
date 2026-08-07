"""Regras de negócio da escala — porte do protótipo (mesma lógica, agora em
Python/servidor, para que a validação não dependa do que roda no navegador."""
import calendar
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.db.models import Atestado, Colaborador, Ferias, Plantao, SolicitacaoFolga


def times_overlap(a_ini: str, a_fim: str, b_ini: str, b_fim: str) -> bool:
    return a_ini < b_fim and b_ini < a_fim


def minutos_do_dia(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def horarios_similares(a_ini: str, a_fim: str, b_ini: str, b_fim: str, buffer_min: int = 90) -> bool:
    if times_overlap(a_ini, a_fim, b_ini, b_fim):
        return True
    return abs(minutos_do_dia(a_ini) - minutos_do_dia(b_ini)) <= buffer_min


def domingos_no_mes(mes: str) -> list[date]:
    ano, mes_num = (int(p) for p in mes.split("-"))
    total_dias = calendar.monthrange(ano, mes_num)[1]
    out = []
    for dia in range(1, total_dias + 1):
        d = date(ano, mes_num, dia)
        if d.weekday() == 6:  # Python: segunda=0 ... domingo=6
            out.append(d)
    return out


def feriados_aplicaveis_no_mes(db: Session, mes: str):
    from app.db.models import Feriado
    ano, mes_num = (int(p) for p in mes.split("-"))
    feriados = db.query(Feriado).all()
    out = []
    for f in feriados:
        if f.data.year == ano and f.data.month == mes_num:
            if f.tipo == "obrigatorio" or f.trabalha:
                out.append(f)
    return out


def datas_alvo_do_mes(db: Session, mes: str) -> list[dict]:
    mapa: dict[date, str] = {}
    for d in domingos_no_mes(mes):
        mapa[d] = "Domingo"
    for f in feriados_aplicaveis_no_mes(db, mes):
        if f.data in mapa:
            mapa[f.data] = f"{f.nome} (domingo)"
        else:
            mapa[f.data] = f.nome
    return [{"data": d, "label": label} for d, label in sorted(mapa.items())]


def contar_plantoes_recentes(db: Session, colaborador_id: str, ref_date: date, janela_dias: int = 60) -> int:
    limite = ref_date - timedelta(days=janela_dias)
    return (
        db.query(Plantao)
        .filter(Plantao.colaborador_id == colaborador_id, Plantao.data < ref_date, Plantao.data >= limite)
        .count()
    )


def dias_desde_ultimo_plantao(db: Session, colaborador_id: str, ref_date: date) -> float:
    ultimo = (
        db.query(Plantao)
        .filter(Plantao.colaborador_id == colaborador_id, Plantao.data < ref_date)
        .order_by(Plantao.data.desc())
        .first()
    )
    if not ultimo:
        return float("inf")
    return (ref_date - ultimo.data).days


def checar_elegibilidade(db: Session, colaborador: Colaborador, equipe: str, data_alvo: date, horario_inicio: str, horario_fim: str) -> tuple[bool, list[str]]:
    motivos = []
    if colaborador.equipe != equipe:
        motivos.append("Setor diferente do solicitado")

    ferias_conflito = (
        db.query(Ferias)
        .filter(Ferias.colaborador_id == colaborador.id, Ferias.status == "aprovada",
                 Ferias.data_inicio <= data_alvo, Ferias.data_fim >= data_alvo)
        .first()
    )
    if ferias_conflito:
        motivos.append("Em férias aprovadas nesta data")

    atestado_conflito = (
        db.query(Atestado)
        .filter(Atestado.colaborador_id == colaborador.id,
                 Atestado.data_inicio <= data_alvo, Atestado.data_fim >= data_alvo)
        .first()
    )
    if atestado_conflito:
        motivos.append("Atestado nesta data")

    folga_conflito = (
        db.query(SolicitacaoFolga)
        .filter(SolicitacaoFolga.colaborador_id == colaborador.id, SolicitacaoFolga.status == "aprovada",
                 SolicitacaoFolga.data_solicitada == data_alvo)
        .first()
    )
    if folga_conflito:
        motivos.append("Folga aprovada nesta data")

    plantoes_do_dia = db.query(Plantao).filter(Plantao.colaborador_id == colaborador.id, Plantao.data == data_alvo).all()
    for p in plantoes_do_dia:
        if times_overlap(p.horario_inicio, p.horario_fim, horario_inicio, horario_fim):
            motivos.append("Já tem plantão nesse horário")
            break

    return (len(motivos) == 0, motivos)


def ordenar_por_justica(db: Session, elegiveis: list[Colaborador], ref_date: date) -> list[Colaborador]:
    def chave(c: Colaborador):
        recentes = contar_plantoes_recentes(db, c.id, ref_date)
        gap = dias_desde_ultimo_plantao(db, c.id, ref_date)
        return (recentes, -gap)
    return sorted(elegiveis, key=chave)
