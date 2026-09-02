import calendar
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.db.models import Atestado, Colaborador, Feriado, Ferias, Plantao, SolicitacaoFolga


# --- Cotas de folga do sindicato: 4 por ano, cada uma numa janela própria ---
# "Maio" abre a partir de 01/mai e pode ser usada até 31/ago; "Agosto" abre em
# 01/ago (ainda dentro da janela de Maio) e vale até 31/out; e assim por
# diante. "Dezembro" cruza o ano civil (vai até fevereiro do ano seguinte).
COTAS_SINDICATO = [
    {"nome": "Maio", "mes_ini": 5, "dia_ini": 1, "mes_fim": 8, "dia_fim": 31},
    {"nome": "Agosto", "mes_ini": 8, "dia_ini": 1, "mes_fim": 10, "dia_fim": 31},
    {"nome": "Outubro", "mes_ini": 10, "dia_ini": 1, "mes_fim": 11, "dia_fim": 30},
    {"nome": "Dezembro", "mes_ini": 12, "dia_ini": 1, "mes_fim": 2, "dia_fim": 28},
]


def _ultimo_dia_mes(ano: int, mes: int, dia_sugerido: int) -> int:
    return min(dia_sugerido, calendar.monthrange(ano, mes)[1])


def identificar_cota_sindicato(data_alvo: date) -> dict | None:
    """Descobre em qual das 4 janelas do 'ano sindical' uma data cai.
    Retorna None se a data estiver fora de qualquer janela (ex: março/abril)."""
    for cota in COTAS_SINDICATO:
        cruza_ano = cota["mes_fim"] < cota["mes_ini"]
        if not cruza_ano:
            ini = date(data_alvo.year, cota["mes_ini"], cota["dia_ini"])
            fim = date(data_alvo.year, cota["mes_fim"], _ultimo_dia_mes(data_alvo.year, cota["mes_fim"], cota["dia_fim"]))
            if ini <= data_alvo <= fim:
                return {"nome": cota["nome"], "ciclo": data_alvo.year, "inicio": ini, "fim": fim}
        else:
            # pode estar na parte que começa neste ano (dez deste ano -> fev do próximo)
            ini = date(data_alvo.year, cota["mes_ini"], cota["dia_ini"])
            fim = date(data_alvo.year + 1, cota["mes_fim"], _ultimo_dia_mes(data_alvo.year + 1, cota["mes_fim"], cota["dia_fim"]))
            if ini <= data_alvo <= fim:
                return {"nome": cota["nome"], "ciclo": data_alvo.year, "inicio": ini, "fim": fim}
            # ou na parte que começou no ano anterior (dez do ano passado -> fev deste ano)
            ini2 = date(data_alvo.year - 1, cota["mes_ini"], cota["dia_ini"])
            fim2 = date(data_alvo.year, cota["mes_fim"], _ultimo_dia_mes(data_alvo.year, cota["mes_fim"], cota["dia_fim"]))
            if ini2 <= data_alvo <= fim2:
                return {"nome": cota["nome"], "ciclo": data_alvo.year - 1, "inicio": ini2, "fim": fim2}
    return None


def ciclo_sindicato_atual(hoje: date | None = None) -> int:
    hoje = hoje or date.today()
    return hoje.year - 1 if hoje.month in (1, 2) else hoje.year


def resumo_cotas_sindicato(db: Session, colaborador_id: str, ciclo: int | None = None) -> dict:
    """Quantas das 4 folgas sindicais desse ciclo já foram usadas (pedidas,
    aprovadas ou pendentes — só rejeitada não conta)."""
    ciclo = ciclo if ciclo is not None else ciclo_sindicato_atual()
    solicitacoes = (
        db.query(SolicitacaoFolga)
        .filter(SolicitacaoFolga.colaborador_id == colaborador_id, SolicitacaoFolga.tipo == "folga_sindicato", SolicitacaoFolga.status != "rejeitada")
        .all()
    )
    usadas_por_cota = {}
    for s in solicitacoes:
        cota = identificar_cota_sindicato(s.data_solicitada)
        if cota and cota["ciclo"] == ciclo:
            usadas_por_cota[cota["nome"]] = s

    cotas_info = []
    for cota in COTAS_SINDICATO:
        uso = usadas_por_cota.get(cota["nome"])
        cotas_info.append({
            "nome": cota["nome"],
            "usada": uso is not None,
            "solicitacao_id": uso.id if uso else None,
            "status": uso.status if uso else None,
        })
    return {"ciclo": ciclo, "total_usadas": len(usadas_por_cota), "total_disponivel": len(COTAS_SINDICATO), "cotas": cotas_info}


# --- Prazo de folga de plantão: 6 dias corridos, ou até o domingo da semana
# seguinte se o plantão foi realizado num feriado ---

def _domingo_da_semana(d: date) -> date:
    return d + timedelta(days=(6 - d.weekday()))


def prazo_folga_plantao(db: Session, data_plantao: date) -> date:
    feriado = db.query(Feriado).filter(Feriado.data == data_plantao).first()
    if feriado:
        domingo_atual = _domingo_da_semana(data_plantao)
        return domingo_atual + timedelta(days=7)  # domingo da semana seguinte
    return data_plantao + timedelta(days=6)


def dia_util_para_folga(db: Session, data_alvo: date) -> tuple[bool, str]:
    """Domingo e feriado não são dias úteis pra agendar uma folga."""
    if data_alvo.weekday() == 6:
        return False, "Não é possível agendar folga num domingo."
    feriado = db.query(Feriado).filter(Feriado.data == data_alvo).first()
    if feriado:
        return False, f"Não é possível agendar folga num feriado ({feriado.nome})."
    return True, ""


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
        if d.weekday() == 6:
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
