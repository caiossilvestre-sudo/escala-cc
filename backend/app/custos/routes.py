"""Gestão de Custos — rotas /custos.

Regras de privacidade:
- Só entra quem está em gc_acessos (por e-mail), seja qual for o perfil.
- A lista de pessoas nunca devolve valores; "revelar" devolve e grava no log.
- Resumos por função/setor só mostram grupos com 3+ pessoas.
"""
import calendar
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador
from app.custos.models import GcAcesso, GcEquip, GcLog, GcParam, GcPessoa, GcVolume, GcVolumeSetor
from app.core.config import settings
from app.db.models import Atestado, Colaborador, Ferias, SolicitacaoFolga
from app.db.session import get_db
from app.logic import resumo_cotas_sindicato

router = APIRouter(prefix="/custos", tags=["custos"])

EMAILS_INICIAIS = ["caiosilvestre@life.net.br", "caio.ssilvestre@gmail.com"]
MIN_GRUPO = 3

PARAMS_PADRAO = {
    "encargos_pct": "45",          # encargos + provisão de férias/13º sobre salário e adicionais
    "horas_mes": "160",
    "absenteismo_pct": "8",
    "ocupacao_pct": "75",
    "wa_concorrencia": "2",        # conversas simultâneas no WhatsApp
    "tma_wa_estimado_seg": "700",  # TMA do WhatsApp usado enquanto o Checkpoint não informar (700 s = 11:40)
    "setores_diretos": "Suporte N1,Suporte N2",
    "setor_n1": "Suporte N1", "setor_n2": "Suporte N2", "setor_monitoramento": "Monitoramento",   # nomes dos setores no cadastro do Escala
    "horas_operacao_dia_n1": "0", "horas_operacao_dia_n2": "0",  # 0 = automático (pelo horário dos colaboradores do setor)
    "dias_operacao_semana": "6", "horas_semana_pessoa": "36",     # N1 e N2 trabalham 36 h por semana
    "cobertura_min_n1": "0", "cobertura_min_n2": "0",              # mínimo de pessoas atendendo ao mesmo tempo (0 = não definido)
    "cobertura_min_monitoramento": "1", "horas_semana_monitoramento": "42",  # 12x36 = 42 h/semana em média; 24x7 com 1 pessoa no mínimo
    "dias_operados_mes": "26",     # dias em que há atendimento no mês (projeção de mês em andamento)
    "rescisao_encargos_pct": "28", # INSS patronal + RAT + terceiros sobre aviso/13º
    "recrutamento": "1500",
    "cobertura_vaga": "1200",
    "exp_etapa1_dias": "45", "exp_etapa1_prod_pct": "50",
    "exp_etapa2_dias": "45", "exp_etapa2_prod_pct": "80",
}


def seed_acessos(db: Session):
    for e in EMAILS_INICIAIS:
        if not db.get(GcAcesso, e):
            db.add(GcAcesso(email=e))
    db.commit()


def _log(db: Session, user: Colaborador, acao: str, alvo: str | None = None):
    db.add(GcLog(email=user.email.lower(), acao=acao, alvo=alvo))
    db.commit()


def tem_acesso(db: Session, user: Colaborador) -> bool:
    return db.get(GcAcesso, (user.email or "").lower()) is not None


def exigir_acesso(user: Colaborador = Depends(get_current_colaborador), db: Session = Depends(get_db)) -> Colaborador:
    if not tem_acesso(db, user):
        raise HTTPException(403, "Sem acesso à Gestão de Custos.")
    return user


def params(db: Session) -> dict:
    p = dict(PARAMS_PADRAO)
    for r in db.query(GcParam).all():
        p[r.chave] = r.valor
    return p


def num(p: dict, k: str) -> float:
    try:
        return float(str(p[k]).replace(",", "."))
    except Exception:
        return float(PARAMS_PADRAO[k])


def custo_pessoa(g: GcPessoa, enc_pct: float) -> dict:
    enc = (g.salario + g.adicionais) * enc_pct / 100
    return {"salario": g.salario, "adicionais": g.adicionais, "beneficios": g.beneficios, "encargos": enc,
            "total": g.salario + g.adicionais + g.beneficios + enc}


def _ativos(db: Session):
    return db.query(Colaborador).filter(Colaborador.status == "ativo", Colaborador.role.in_(["colaborador", "supervisor"])).all()


# ---------------- acesso ----------------
@router.get("/acesso")
def acesso(user: Colaborador = Depends(get_current_colaborador), db: Session = Depends(get_db)):
    return {"permitido": tem_acesso(db, user)}


class EmailIn(BaseModel):
    email: str = Field(min_length=5, max_length=200)


@router.get("/acessos")
def listar_acessos(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    return [a.email for a in db.query(GcAcesso).order_by(GcAcesso.email).all()]


@router.post("/acessos")
def liberar(body: EmailIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    e = body.email.strip().lower()
    if "@" not in e:
        raise HTTPException(400, "E-mail inválido.")
    if not db.get(GcAcesso, e):
        db.add(GcAcesso(email=e)); db.commit()
        _log(db, user, "liberar_acesso", e)
    return listar_acessos(user, db)


@router.delete("/acessos/{email}")
def remover_acesso(email: str, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    e = email.strip().lower()
    if db.query(GcAcesso).count() <= 1:
        raise HTTPException(400, "Precisa sobrar pelo menos 1 pessoa com acesso.")
    a = db.get(GcAcesso, e)
    if a:
        db.delete(a); db.commit(); _log(db, user, "remover_acesso", e)
    return listar_acessos(user, db)


# ---------------- parâmetros ----------------
@router.get("/params")
def get_params(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    return params(db)


@router.post("/params")
def set_params(body: dict, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    for k, v in body.items():
        if k not in PARAMS_PADRAO:
            continue
        r = db.get(GcParam, k)
        if r:
            r.valor = str(v)
        else:
            db.add(GcParam(chave=k, valor=str(v)))
    db.commit(); _log(db, user, "alterar_parametros")
    return params(db)


# ---------------- pessoas ----------------
class PessoaIn(BaseModel):
    funcao: str = Field(default="", max_length=80)
    salario: float = Field(ge=0, le=1_000_000)
    adicionais: float = Field(default=0, ge=0, le=1_000_000)
    beneficios: float = Field(default=0, ge=0, le=1_000_000)


@router.get("/pessoas")
def listar_pessoas(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    reg = {g.colaborador_id: g for g in db.query(GcPessoa).all()}
    out = []
    for c in sorted(_ativos(db), key=lambda x: x.nome.lower()):
        g = reg.get(c.id)
        out.append({"id": c.id, "nome": c.nome, "equipe": c.equipe, "admissao": c.data_admissao.isoformat() if c.data_admissao else None,
                    "funcao": g.funcao if g else "", "cadastrado": g is not None})
    return out


@router.post("/pessoas/{cid}/revelar")
def revelar(cid: str, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    g = db.get(GcPessoa, cid)
    if not g:
        raise HTTPException(404, "Sem custo cadastrado.")
    c = db.get(Colaborador, cid)
    _log(db, user, "revelar_valores", c.nome if c else cid)
    r = custo_pessoa(g, num(params(db), "encargos_pct"))
    return {**r, "funcao": g.funcao}


@router.put("/pessoas/{cid}")
def salvar_pessoa(cid: str, body: PessoaIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    c = db.get(Colaborador, cid)
    if not c:
        raise HTTPException(404, "Colaborador não encontrado.")
    g = db.get(GcPessoa, cid) or GcPessoa(colaborador_id=cid)
    g.funcao, g.salario, g.adicionais, g.beneficios = body.funcao.strip(), body.salario, body.adicionais, body.beneficios
    db.add(g); db.commit(); _log(db, user, "salvar_custo", c.nome)
    return {"ok": True}


class LoteIn(BaseModel):
    colaborador_ids: list[str]
    funcao: str = Field(default="", max_length=80)
    salario: float = Field(ge=0, le=1_000_000)
    adicionais: float = Field(default=0, ge=0, le=1_000_000)
    beneficios: float = Field(default=0, ge=0, le=1_000_000)


@router.post("/pessoas/lote")
def salvar_lote(body: LoteIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    n = 0
    for cid in body.colaborador_ids:
        if not db.get(Colaborador, cid):
            continue
        g = db.get(GcPessoa, cid) or GcPessoa(colaborador_id=cid)
        g.funcao, g.salario, g.adicionais, g.beneficios = body.funcao.strip(), body.salario, body.adicionais, body.beneficios
        db.add(g); n += 1
    db.commit(); _log(db, user, "salvar_custo_lote", f"{n} pessoas")
    return {"salvos": n}


# ---------------- equipamentos ----------------
class EquipIn(BaseModel):
    tipo: str = Field(min_length=1, max_length=60)
    modelo: str = Field(default="", max_length=120)
    quantidade: int = Field(default=1, ge=1, le=10000)
    valor_unit: float = Field(ge=0, le=10_000_000)
    data_compra: date
    setor: str | None = None
    colaborador_id: str | None = None
    vida_util_meses: int = Field(default=24, ge=1, le=120)
    obs: str | None = Field(default=None, max_length=500)


def _equip_out(e: GcEquip, nomes: dict) -> dict:
    total = e.quantidade * e.valor_unit
    return {"id": e.id, "tipo": e.tipo, "modelo": e.modelo, "quantidade": e.quantidade, "valor_unit": e.valor_unit,
            "total": total, "data_compra": e.data_compra.isoformat(), "setor": e.setor,
            "colaborador_id": e.colaborador_id, "colaborador": nomes.get(e.colaborador_id), "vida_util_meses": e.vida_util_meses,
            "custo_mensal": total / e.vida_util_meses, "obs": e.obs}


@router.get("/equipamentos")
def listar_equip(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    nomes = {c.id: c.nome for c in db.query(Colaborador).all()}
    return [_equip_out(e, nomes) for e in db.query(GcEquip).order_by(GcEquip.data_compra.desc()).all()]


@router.post("/equipamentos")
def criar_equip(body: EquipIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    e = GcEquip(**body.model_dump())
    db.add(e); db.commit(); _log(db, user, "criar_equipamento", f"{body.tipo} {body.modelo}")
    return listar_equip(user, db)


@router.delete("/equipamentos/{eid}")
def apagar_equip(eid: str, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    e = db.get(GcEquip, eid)
    if e:
        db.delete(e); db.commit(); _log(db, user, "apagar_equipamento", f"{e.tipo} {e.modelo}")
    return listar_equip(user, db)


# ---------------- volume ----------------
class VolumeIn(BaseModel):
    mes: str = Field(pattern=r"^\d{4}-\d{2}$")
    telefone: int = Field(ge=0, le=10_000_000)
    whatsapp: int = Field(ge=0, le=10_000_000)
    tma_tel_seg: int = Field(ge=0, le=36000)
    tma_wa_seg: int = Field(ge=0, le=36000)
    tme_seg: int = Field(default=0, ge=0, le=36000)


@router.get("/volume")
def listar_volume(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    return [{"mes": v.mes, "telefone": v.telefone, "whatsapp": v.whatsapp, "tma_tel_seg": v.tma_tel_seg,
             "tma_wa_seg": v.tma_wa_seg, "tme_seg": v.tme_seg} for v in db.query(GcVolume).order_by(GcVolume.mes.desc()).limit(12).all()]


@router.put("/volume")
def salvar_volume(body: VolumeIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    v = db.get(GcVolume, body.mes) or GcVolume(mes=body.mes)
    v.telefone, v.whatsapp, v.tma_tel_seg, v.tma_wa_seg, v.tme_seg = body.telefone, body.whatsapp, body.tma_tel_seg, body.tma_wa_seg, body.tme_seg
    db.add(v); db.commit(); _log(db, user, "salvar_volume", body.mes)
    return listar_volume(user, db)


# ---------------- integração com o Checkpoint ----------------
def _buscar_checkpoint(de: date, ate: date) -> list[dict]:
    if not settings.checkpoint_api_key:
        raise HTTPException(503, "Integração não configurada: defina CHECKPOINT_API_KEY no .env do Escala.")
    url = f"{settings.checkpoint_base_url.rstrip('/')}/api/integracao/volume?" + urllib.parse.urlencode({"de": de.isoformat(), "ate": ate.isoformat()})
    req = urllib.request.Request(url, headers={"X-API-Key": settings.checkpoint_api_key})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            dados = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"O Checkpoint recusou a consulta (HTTP {e.code}). Confira a chave CHECKPOINT_API_KEY.")
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise HTTPException(502, "Não consegui falar com o Checkpoint. Ele está no ar?")
    if not isinstance(dados, list):
        raise HTTPException(502, "Resposta inesperada do Checkpoint.")
    return dados


class SyncIn(BaseModel):
    mes: str = Field(pattern=r"^\d{4}-\d{2}$")


def _media(pares: list[tuple]) -> int:
    """Média ponderada de (valor, peso); ignora quem não tem valor."""
    pares = [(v, w) for v, w in pares if v is not None and w]
    peso = sum(w for _, w in pares)
    return round(sum(v * w for v, w in pares) / peso) if peso else 0


def sincronizar_mes(db: Session, mes: str) -> dict:
    """Busca o mês no Checkpoint e grava em gc_volume. Usada pelo botão e pela rotina diária."""
    ano, m = int(mes[:4]), int(mes[5:])
    if not 1 <= m <= 12:
        raise HTTPException(400, "Mês inválido.")
    de, ate = date(ano, m, 1), date(ano, m, calendar.monthrange(ano, m)[1])
    linhas = _buscar_checkpoint(de, ate)
    tel = wa = 0
    por_setor: dict = {}
    dias = set()
    for l in linhas:
        t, w = int(l.get("telefone") or 0), int(l.get("whatsapp") or 0)
        tel += t; wa += w
        if t or w:
            dias.add(l.get("data"))
        s = por_setor.setdefault(str(l.get("setor") or "?"), {"telefone": 0, "whatsapp": 0})
        s["telefone"] += t; s["whatsapp"] += w
    tma_tel = _media([(l.get("tma_tel_seg"), int(l.get("telefone") or 0)) for l in linhas])
    tme_tel = _media([(l.get("tme_tel_seg"), int(l.get("telefone") or 0)) for l in linhas])
    tme_wa = _media([(l.get("tme_wa_seg"), int(l.get("whatsapp") or 0)) for l in linhas])
    for chave, s in por_setor.items():
        ls = [l for l in linhas if str(l.get("setor") or "?") == chave]
        gs = db.get(GcVolumeSetor, (mes, chave)) or GcVolumeSetor(mes=mes, setor=chave)
        gs.telefone, gs.whatsapp = s["telefone"], s["whatsapp"]
        gs.tma_tel_seg = _media([(l.get("tma_tel_seg"), int(l.get("telefone") or 0)) for l in ls])
        gs.dias = len({l.get("data") for l in ls if int(l.get("telefone") or 0) or int(l.get("whatsapp") or 0)})
        db.add(gs)
    v = db.get(GcVolume, mes) or GcVolume(mes=mes, tma_wa_seg=0)
    v.telefone, v.whatsapp, v.tma_tel_seg, v.tme_seg = tel, wa, tma_tel, tme_tel
    # O Checkpoint não informa o TMA do WhatsApp: mantém o que já foi digitado.
    db.add(v); db.commit()
    return {"mes": mes, "telefone": tel, "whatsapp": wa, "tma_tel_seg": tma_tel, "tme_tel_seg": tme_tel, "tme_wa_seg": tme_wa,
            "tma_wa_seg": v.tma_wa_seg, "dias_com_dado": len(dias), "por_setor": por_setor}


def registrar_sync(db: Session, origem: str, ok: bool, msg: str):
    valor = f"{datetime.now().isoformat(timespec='minutes')}|{origem}|{'ok' if ok else 'erro'}|{msg}"
    r = db.get(GcParam, "sync_ultima")
    if r:
        r.valor = valor
    else:
        db.add(GcParam(chave="sync_ultima", valor=valor))
    db.commit()


@router.post("/volume/sincronizar")
def sincronizar_volume(body: SyncIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    r = sincronizar_mes(db, body.mes)
    _log(db, user, "sincronizar_volume", body.mes)
    registrar_sync(db, "manual", True, body.mes)
    return r


# ---------------- visão geral ----------------
def _custos_ativos(db: Session, enc: float):
    """[(Colaborador, GcPessoa, custo_dict)] só de quem tem custo cadastrado."""
    reg = {g.colaborador_id: g for g in db.query(GcPessoa).all()}
    return [(c, reg[c.id], custo_pessoa(reg[c.id], enc)) for c in _ativos(db) if c.id in reg]


def _equip_mensal(db: Session) -> tuple[float, float]:
    hoje = date.today(); mensal = invest = 0.0
    for e in db.query(GcEquip).all():
        total = e.quantidade * e.valor_unit
        invest += total
        meses = (hoje.year - e.data_compra.year) * 12 + hoje.month - e.data_compra.month
        if meses < e.vida_util_meses:
            mensal += total / e.vida_util_meses
    return mensal, invest


@router.get("/resumo")
def resumo(ano: int | None = None, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    p = params(db); enc = num(p, "encargos_pct")
    ano = ano or date.today().year
    ativos = _ativos(db)
    itens = _custos_ativos(db, enc)
    mensal = sum(x[2]["total"] for x in itens)
    comp = {k: sum(x[2][k] for x in itens) for k in ("salario", "adicionais", "beneficios", "encargos")}
    eq_mensal, eq_invest = _equip_mensal(db)

    def agrupar(chave):
        g = {}
        for c, gp, r in itens:
            g.setdefault(chave(c, gp) or "Sem função", []).append(r["total"])
        out, oculto_n = [], 0
        for k, v in sorted(g.items()):
            if len(v) >= MIN_GRUPO:
                out.append({"nome": k, "pessoas": len(v), "media": sum(v) / len(v), "total_mensal": sum(v)})
            else:
                oculto_n += len(v)
        if oculto_n:
            out.append({"nome": "Agrupados (menos de 3 pessoas por grupo)", "pessoas": oculto_n, "media": None, "total_mensal": None})
        return out

    # ausências do ano: dia = custo mensal ÷ 30
    dia = {c.id: r["total"] / 30 for c, gp, r in itens}
    ini, fim = date(ano, 1, 1), date(ano, 12, 31)
    ferias = sum(((min(f.data_fim, fim) - max(f.data_inicio, ini)).days + 1) * dia[f.colaborador_id]
                 for f in db.query(Ferias).filter(Ferias.status == "aprovada", Ferias.data_inicio <= fim, Ferias.data_fim >= ini) if f.colaborador_id in dia)
    atest = sum(((min(a.data_fim, fim) - max(a.data_inicio, ini)).days + 1) * dia[a.colaborador_id]
                for a in db.query(Atestado).filter(Atestado.data_inicio <= fim, Atestado.data_fim >= ini) if a.colaborador_id in dia)
    folgas = {"folga_sindicato": [0, 0.0], "folga_plantao": [0, 0.0]}
    for s in db.query(SolicitacaoFolga).filter(SolicitacaoFolga.status == "aprovada", SolicitacaoFolga.data_solicitada >= ini, SolicitacaoFolga.data_solicitada <= fim):
        if s.tipo in folgas and s.colaborador_id in dia:
            folgas[s.tipo][0] += 1; folgas[s.tipo][1] += dia[s.colaborador_id]

    vols = db.query(GcVolume).order_by(GcVolume.mes.desc()).limit(6).all()
    cpa = None
    if vols and (vols[0].telefone + vols[0].whatsapp) > 0:
        cpa = {"mes": vols[0].mes, "atendimentos": vols[0].telefone + vols[0].whatsapp,
               "custo_total": (mensal + eq_mensal) / (vols[0].telefone + vols[0].whatsapp)}
    return {
        "ano": ano, "pessoas_ativas": len(ativos), "pessoas_com_custo": len(itens), "encargos_pct": enc,
        "custo_mensal": mensal + eq_mensal, "custo_anual": (mensal + eq_mensal) * 12,
        "pessoas_mensal": mensal, "equipamentos_mensal": eq_mensal, "equipamentos_investido": eq_invest,
        "composicao": {**comp, "equipamentos": eq_mensal},   # mensal
        "por_funcao": agrupar(lambda c, gp: gp.funcao), "por_setor": agrupar(lambda c, gp: c.equipe),
        "ausencias_ano": {"ferias": ferias, "atestados": atest, "folgas_cct": {"qtd": folgas["folga_sindicato"][0], "valor": folgas["folga_sindicato"][1]},
                          "folgas_plantao": {"qtd": folgas["folga_plantao"][0], "valor": folgas["folga_plantao"][1]}},
        "custo_por_atendimento": cpa,
        "historico_cpa": [{"mes": v.mes, "atendimentos": v.telefone + v.whatsapp,
                           "valor": ((mensal + eq_mensal) / (v.telefone + v.whatsapp)) if (v.telefone + v.whatsapp) else None} for v in reversed(vols)],
    }


# ---------------- ausências / CCT ----------------
@router.get("/cct")
def cct(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    linhas = []
    ciclo = None
    for c in sorted(_ativos(db), key=lambda x: x.nome.lower()):
        r = resumo_cotas_sindicato(db, c.id)
        ciclo = r["ciclo"]
        linhas.append({"nome": c.nome, "equipe": c.equipe, "usadas": r["total_usadas"], "total": r["total_disponivel"]})
    linhas.sort(key=lambda x: (x["usadas"], x["nome"].lower()))
    return {"ciclo": ciclo, "linhas": linhas}


def _ultima_sync(db: Session):
    r = db.get(GcParam, "sync_ultima")
    if not r:
        return None
    q, origem, st, msg = (r.valor.split("|", 3) + ["", "", "", ""])[:4]
    return {"quando": q, "origem": origem, "ok": st == "ok", "msg": msg}


# ---------------- cobertura real pela escala ----------------
def _fracao_dias(escala_tipo: str) -> float:
    """Parte dos dias em que a pessoa trabalha (6x1 = 6/7, 5x2 = 5/7, 12x36 = 1/2)."""
    import re
    m = re.match(r"^\s*(\d+)\s*x\s*(\d+)\s*$", escala_tipo or "")
    if not m:
        return 6 / 7
    a, b = int(m.group(1)), int(m.group(2))
    if a == 12 and b == 36:
        return 0.5
    return a / (a + b) if a + b else 6 / 7


def _min(hhmm: str | None) -> int | None:
    try:
        h, m = (hhmm or "").split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def _sobreposicao(ini: int, fim: int, h: int) -> float:
    """Minutos do intervalo [ini, fim) (pode cruzar a meia-noite) que caem na hora h."""
    if fim <= ini:
        fim += 1440
    total = 0
    for off in (-1440, 0):
        a, b = ini + off, fim + off
        total += max(0, min(b, (h + 1) * 60) - max(a, h * 60))
    return total / 60


def perfil_horario(pessoas: list, abs_pct: float) -> tuple[list[float], list[bool]]:
    """Pessoas em serviço em cada hora do dia (média da semana), pelo cadastro de colaboradores:
    expediente, intervalo (descontado), tipo de escala (folgas) e absenteísmo."""
    perfil, coberta = [0.0] * 24, [False] * 24
    for c in pessoas:
        ini, fim = _min(c.horario_inicio), _min(c.horario_fim)
        if ini is None or fim is None:
            continue
        ii, ff = _min(c.intervalo_inicio), _min(c.intervalo_fim)
        frac = _fracao_dias(c.escala_tipo) * (1 - abs_pct / 100)
        for h in range(24):
            t = _sobreposicao(ini, fim, h)
            if t <= 0:
                continue
            coberta[h] = True
            if ii is not None and ff is not None:
                t = max(0.0, t - min(t, _sobreposicao(ii, ff, h)))
            perfil[h] += t * frac
    return [round(x, 1) for x in perfil], coberta


# ---------------- capacidade ----------------
@router.get("/capacidade")
def capacidade(user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    p = params(db)
    v = db.query(GcVolume).order_by(GcVolume.mes.desc()).first()
    ativos = _ativos(db)
    enc = num(p, "encargos_pct")
    reg = {g.colaborador_id: g for g in db.query(GcPessoa).all()}

    abs_pct = num(p, "absenteismo_pct")

    def grupo(nomes: list[str]):
        pess = [c for c in ativos if c.equipe in nomes]
        perfil, coberta = perfil_horario(pess, abs_pct)
        custos = [custo_pessoa(reg[c.id], enc)["total"] for c in pess if c.id in reg]
        return {"perfil": perfil, "horas_cobertas": sum(coberta),
                "pessoas": len(pess), "sem_custo": len(pess) - len(custos), "custo_mensal": sum(custos),
                "custo_medio": (sum(custos) / len(custos)) if custos else None}

    mensal_total = sum(custo_pessoa(g, enc)["total"] for c in ativos if (g := reg.get(c.id))) + _equip_mensal(db)[0]
    tma_wa = (v.tma_wa_seg if v else 0) or int(num(p, "tma_wa_estimado_seg"))
    dias_op = num(p, "dias_operados_mes")
    segmentos, mes = [], v.mes if v else None
    por_setor = db.query(GcVolumeSetor).filter(GcVolumeSetor.mes == mes).all() if mes else []
    if por_setor:
        nomes = {"n1": ("Suporte N1", p["setor_n1"]), "n2": ("Suporte N2", p["setor_n2"])}
        em_andamento = mes == date.today().strftime("%Y-%m")
        for chave in ("n1", "n2"):
            gs = next((x for x in por_setor if x.setor == chave), None)
            rotulo, equipe = nomes[chave]
            fator = (dias_op / gs.dias) if (gs and em_andamento and 0 < gs.dias < dias_op) else 1
            segmentos.append({"chave": chave, "nome": rotulo, "equipe": equipe, **grupo([equipe]),
                              "cobertura_min": num(p, f"cobertura_min_{chave}"), "horas_operacao_dia": num(p, f"horas_operacao_dia_{chave}"),   # 0 = automático
                              "volume": None if not gs else {"telefone": round(gs.telefone * fator), "whatsapp": round(gs.whatsapp * fator),
                                                             "tma_tel_seg": gs.tma_tel_seg, "tma_wa_seg": tma_wa, "dias": gs.dias, "projetado": fator != 1}})
    elif v:
        diretos = [s.strip() for s in p["setores_diretos"].split(",") if s.strip()]
        segmentos.append({"chave": "total", "nome": "Atendimento direto", "equipe": ", ".join(diretos), **grupo(diretos),
                          "cobertura_min": num(p, "cobertura_min_n1"), "horas_operacao_dia": num(p, "horas_operacao_dia_n1"),
                          "volume": {"telefone": v.telefone, "whatsapp": v.whatsapp, "tma_tel_seg": v.tma_tel_seg, "tma_wa_seg": tma_wa, "dias": 0, "projetado": False}})
    mon = {"nome": "Monitoramento", "equipe": p["setor_monitoramento"], **grupo([p["setor_monitoramento"]])}
    mon_min, mon_h = num(p, "cobertura_min_monitoramento"), num(p, "horas_semana_monitoramento")
    mon["cobertura_min"] = mon_min
    mon["precisa"] = math.ceil(mon_min * 24 * 7 / mon_h / (1 - abs_pct / 100) - 0.05) if mon_min > 0 and mon_h > 0 else 0
    for sg in segmentos:       # horas de funcionamento automáticas, quando o parâmetro está em 0
        if not sg["horas_operacao_dia"]:
            sg["horas_operacao_dia"] = sg["horas_cobertas"] or 12
    usados = {x["equipe"] for x in segmentos} | {p["setor_monitoramento"]}
    resto = sum(custo_pessoa(g, enc)["total"] for c in ativos if c.equipe not in usados and (g := reg.get(c.id)))
    return {
        "mes": mes, "segmentos": segmentos, "monitoramento": mon,
        "outros_custo_mensal": resto + _equip_mensal(db)[0],
        "horas_mes": num(p, "horas_mes"), "absenteismo_pct": num(p, "absenteismo_pct"), "ocupacao_pct": num(p, "ocupacao_pct"),
        "wa_concorrencia": num(p, "wa_concorrencia"), "dias_operacao_semana": num(p, "dias_operacao_semana"),
        "horas_semana_pessoa": num(p, "horas_semana_pessoa"), "dias_operados_mes": dias_op, "tma_wa_estimado": not (v and v.tma_wa_seg),
        "custo_mensal_total": mensal_total,
        "ultima_sync": _ultima_sync(db),
        "sync_ativa": bool(settings.checkpoint_api_key),
    }


# ---------------- desligamento ----------------
class DeslIn(BaseModel):
    colaborador_id: str
    ferias_vencidas_dias: int = Field(default=0, ge=0, le=60)
    novo_custo_pct: float = Field(default=100, ge=1, le=300)   # custo do substituto vs. o atual


@router.post("/desligamento")
def desligamento(body: DeslIn, user: Colaborador = Depends(exigir_acesso), db: Session = Depends(get_db)):
    c = db.get(Colaborador, body.colaborador_id)
    g = db.get(GcPessoa, body.colaborador_id)
    if not c or not g:
        raise HTTPException(400, "Cadastre o custo desta pessoa antes de simular.")
    if not c.data_admissao:
        raise HTTPException(400, "Falta a data de admissão no cadastro do colaborador.")
    p = params(db); enc = num(p, "encargos_pct")
    _log(db, user, "simular_desligamento", c.nome)
    hoje = date.today()
    rem = g.salario + g.adicionais
    custo = custo_pessoa(g, enc)["total"]
    anos = max(0, (hoje - c.data_admissao).days // 365)
    meses_casa = max(1, (hoje.year - c.data_admissao.year) * 12 + hoje.month - c.data_admissao.month)
    aviso_dias = min(90, 30 + 3 * anos)
    saldo = rem / 30 * hoje.day
    aviso = rem / 30 * aviso_dias
    proj = aviso_dias / 30
    meses_ferias = ((hoje.month - c.data_admissao.month) % 12) + proj
    ferias_prop = rem * min(meses_ferias, 12) / 12 * 4 / 3
    ferias_venc = rem / 30 * body.ferias_vencidas_dias * 4 / 3
    meses_13 = min(12, hoje.month + round(proj))
    dec13 = rem * meses_13 / 12
    fgts_extra = 0.08 * (aviso + dec13)
    multa = 0.4 * (0.08 * rem * meses_casa + fgts_extra)
    enc_resc = num(p, "rescisao_encargos_pct") / 100 * (saldo + aviso + dec13)
    itens = [
        ("Saldo de salário", saldo, True), ("Aviso prévio indenizado", aviso, False),
        ("Férias proporcionais + 1/3", ferias_prop, True), ("Férias vencidas + 1/3", ferias_venc, True),
        ("13º proporcional", dec13, True), ("Multa de 40% do FGTS", multa, False),
        ("FGTS de 8% sobre aviso e 13º", fgts_extra, False), ("Encargos patronais sobre as verbas", enc_resc, False),
    ]
    total = sum(i[1] for i in itens); extra = sum(i[1] for i in itens if not i[2])
    novo = custo * body.novo_custo_pct / 100
    e1, e2 = num(p, "exp_etapa1_dias"), num(p, "exp_etapa2_dias")
    perda1 = novo * e1 / 30 * (1 - num(p, "exp_etapa1_prod_pct") / 100)
    perda2 = novo * e2 / 30 * (1 - num(p, "exp_etapa2_prod_pct") / 100)
    recr, cob = num(p, "recrutamento"), num(p, "cobertura_vaga")
    repor = perda1 + perda2 + recr + cob

    def cen(nome, desc, custo_unico, eco):
        return {"nome": nome, "desc": desc, "custo_unico": custo_unico, "economia_mensal": eco,
                "payback_meses": (custo_unico / eco) if eco > 0 else None, "resultado_12m": eco * 12 - custo_unico}
    return {
        "pessoa": c.nome, "custo_mensal": custo, "anos_casa": anos, "aviso_dias": aviso_dias,
        "rescisao": [{"nome": n, "valor": v, "provisionado": pv} for n, v, pv in itens],
        "rescisao_total": total, "rescisao_extra": extra,
        "reposicao": [{"nome": f"Experiência etapa 1 ({int(e1)} dias)", "valor": perda1}, {"nome": f"Experiência etapa 2 ({int(e2)} dias)", "valor": perda2},
                      {"nome": "Recrutamento e seleção", "valor": recr}, {"nome": "Cobertura da vaga (hora extra)", "valor": cob}],
        "reposicao_total": repor, "transicao_total": extra + repor,
        "cenarios": [
            cen("Desligar e não repor", "Só se a demanda não justificar a vaga", extra, custo),
            cen("Desligar e repor", f"Substituto a {body.novo_custo_pct:g}% do custo atual", extra + repor, custo - novo),
        ],
    }
