"""Passagem de plantão (12x36) — rotas sob /ferramentas/passagem.

Fica dentro do prefixo /ferramentas, que já está liberado no Nginx: não
precisa mexer no escala.conf.

Fluxo:
  1. Quem sai do plantão registra: o que houve (resumo), recado para o
     próximo e as pendências por categoria (PRTG, IXC, Zammad, Projetos,
     Outros). Em cada uma das 4 categorias principais é obrigatório OU
     lançar pelo menos um item OU marcar "nada pendente".
  2. Quem entra dá "ciência" (fica registrado quem e quando).
  3. As pendências continuam abertas de plantão em plantão até alguém dar
     baixa (com a solução). Dá para comentar o andamento sem duplicar.
  4. O gestor vê indicadores (ciência, pendências por categoria, tempo de
     resolução) e pode editar/excluir qualquer registro.

E-mail opcional: com PASSAGEM_EMAIL_PARA no .env (lista separada por
vírgula), cada passagem enviada vai por e-mail usando o SMTP do sistema.
"""
import os
import smtplib
from datetime import date, datetime, timedelta
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import log_action
from app.db.models import Colaborador
from app.db.session import get_db
from app.ferramentas.models import FtPassagem, FtPendencia
from app.ferramentas.schemas import PassagemIn, PendenciaAcaoIn
from app.ferramentas.seguranca import exigir

REGISTRAR, GERENCIAR = exigir("passagem.registrar"), exigir("passagem.gerenciar")
FUSO = ZoneInfo("America/Sao_Paulo")

CATEGORIAS = {
    "prtg": "PRTG",
    "ixc": "IXC",
    "zammad": "Zammad",
    "projeto": "Projetos",
    "outro": "Outros",
}
OBRIGATORIAS = ["prtg", "ixc", "zammad", "projeto"]  # "outro" é opcional
PARA = {"horario_comercial": "Horário comercial", "proximo_plantao": "Próximo plantão"}
TURNO = {"diurno": "Diurno", "noturno": "Noturno"}

router = APIRouter(prefix="/passagem", tags=["ferramentas · passagem de plantão"])


# ------------------------------------------------------------------ helpers

def _gerencia(user) -> bool:
    return "passagem.gerenciar" in getattr(user, "ft_permissoes", set())


def _nomes(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {c.id: c.nome for c in db.query(Colaborador).filter(Colaborador.id.in_(ids)).all()}


def _ordem(p: FtPassagem):
    """Mais recente primeiro: dia de início e, no mesmo dia, noturno depois do diurno."""
    return (p.data, 1 if p.turno == "noturno" else 0, p.enviado_em or datetime.min)


def _sugestao_turno() -> dict:
    """Plantão que a pessoa provavelmente está encerrando agora (com 1h de folga
    para quem registra um pouco depois da troca)."""
    t = datetime.now(FUSO) - timedelta(hours=1)
    if 7 <= t.hour < 19:
        return {"data": t.date().isoformat(), "turno": "diurno", "horario_inicio": "07:00", "horario_fim": "19:00"}
    dia = t.date() if t.hour >= 19 else t.date() - timedelta(days=1)
    return {"data": dia.isoformat(), "turno": "noturno", "horario_inicio": "19:00", "horario_fim": "07:00"}


def _pend_dict(p: FtPendencia, nomes: dict, passagem: FtPassagem | None = None) -> dict:
    return {
        "id": p.id, "passagem_id": p.passagem_id, "categoria": p.categoria,
        "referencia": p.referencia, "descricao": p.descricao, "para": p.para,
        "prioridade": p.prioridade, "link": p.link, "status": p.status,
        "criada_em": p.criada_em, "criada_por": nomes.get(p.criada_por_id),
        "resolvida_em": p.resolvida_em, "resolvida_por": nomes.get(p.resolvida_por_id),
        "resolucao": p.resolucao,
        "historico": [{**h, "por": nomes.get(h.get("por_id"))} for h in (p.historico or [])],
        "origem": {"data": passagem.data, "turno": passagem.turno, "autor": nomes.get(passagem.autor_id)} if passagem else None,
    }


def _ids_pessoas(pends) -> set:
    ids = set()
    for p in pends:
        ids |= {p.criada_por_id, p.resolvida_por_id}
        ids |= {h.get("por_id") for h in (p.historico or [])}
    return ids


def _passagem_dict(db: Session, p: FtPassagem, completa: bool = True) -> dict:
    pends = db.query(FtPendencia).filter(FtPendencia.passagem_id == p.id).order_by(FtPendencia.criada_em).all()
    nomes = _nomes(db, {p.autor_id, p.ciencia_por_id} | _ids_pessoas(pends))
    base = {
        "id": p.id, "autor_id": p.autor_id, "autor": nomes.get(p.autor_id), "equipe": p.equipe,
        "data": p.data, "turno": p.turno, "horario_inicio": p.horario_inicio, "horario_fim": p.horario_fim,
        "enviado_em": p.enviado_em, "editado_em": p.editado_em,
        "ciencia_por": nomes.get(p.ciencia_por_id), "ciencia_em": p.ciencia_em,
        "sem_pendencia": p.sem_pendencia or [],
        "qtd_pendencias": len(pends),
        "qtd_abertas": sum(1 for x in pends if x.status == "aberta"),
        "qtd_alta": sum(1 for x in pends if x.status == "aberta" and x.prioridade == "alta"),
    }
    if completa:
        base.update({"resumo": p.resumo, "recados": p.recados, "pendencias": [_pend_dict(x, nomes) for x in pends]})
    else:
        base["resumo_curto"] = (p.resumo or "")[:220]
    return base


def _filtro_equipe(q, equipe: str | None):
    return q.filter(FtPassagem.equipe == equipe) if equipe else q


def _validar_categorias(body: PassagemIn) -> list[str]:
    com_item = {p.categoria for p in body.pendencias}
    faltando = [CATEGORIAS[c] for c in OBRIGATORIAS if c not in com_item and c not in body.sem_pendencia]
    if faltando:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Informe as pendências ou marque \"nada pendente\" em: {', '.join(faltando)}.",
        )
    # categoria com item lançado não pode ficar marcada como "nada pendente"
    return [c for c in OBRIGATORIAS + ["outro"] if c in body.sem_pendencia and c not in com_item]


def _limpo(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def _aplicar_pendencias(db: Session, passagem: FtPassagem, body: PassagemIn, user, editar: bool):
    existentes = {x.id: x for x in db.query(FtPendencia).filter(FtPendencia.passagem_id == passagem.id).all()} if editar else {}
    vistos = set()
    for item in body.pendencias:
        dados = {k: _limpo(v) for k, v in item.model_dump(exclude={"id"}).items()}
        if dados["link"] and not dados["link"].lower().startswith(("http://", "https://")):
            dados["link"] = "https://" + dados["link"]
        alvo = existentes.get(item.id) if item.id else None
        if alvo:
            vistos.add(alvo.id)
            for k, v in dados.items():
                setattr(alvo, k, v)
        else:
            db.add(FtPendencia(passagem_id=passagem.id, criada_por_id=user.id, historico=[], **dados))
    # na edição, item que saiu da lista é removido (só os ainda abertos;
    # pendência já resolvida fica como histórico)
    for pid, x in existentes.items():
        if pid not in vistos and x.status == "aberta":
            db.delete(x)


def _enviar_email(texto: str, assunto: str):
    para = [e.strip() for e in os.getenv("PASSAGEM_EMAIL_PARA", "").split(",") if e.strip()]
    if not para or not (settings.smtp_host and settings.smtp_user and settings.smtp_password and settings.smtp_from_email):
        return
    msg = MIMEText(texto, "plain", "utf-8")
    msg["Subject"] = f"[Suporte Técnico] {assunto}"
    msg["From"] = f"{settings.smtp_from_nome} <{settings.smtp_from_email}>"
    msg["To"] = ", ".join(para)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
            s.starttls()
            s.login(settings.smtp_user, settings.smtp_password)
            s.sendmail(settings.smtp_from_email, para, msg.as_string())
    except Exception as e:  # e-mail nunca derruba o registro
        print(f"[passagem] falha ao enviar e-mail: {e}")


def _texto_email(d: dict) -> tuple[str, str]:
    data = d["data"].strftime("%d/%m/%Y") if isinstance(d["data"], date) else str(d["data"])
    assunto = f"Passagem de plantão {TURNO[d['turno']].lower()} {data} — {d['autor']}"
    linhas = [
        f"Plantão {TURNO[d['turno']].lower()} de {data} ({d['horario_inicio']}–{d['horario_fim']})",
        f"Registrado por: {d['autor']}" + (f" · {d['equipe']}" if d.get("equipe") else ""),
        "", "O QUE HOUVE NO PLANTÃO", d["resumo"], "",
    ]
    if d.get("recados"):
        linhas += ["RECADO PARA O PRÓXIMO PLANTÃO", d["recados"], ""]
    for cod, nome in CATEGORIAS.items():
        itens = [p for p in d["pendencias"] if p["categoria"] == cod]
        if itens:
            linhas.append(f"{nome.upper()} — {len(itens)} pendência(s)")
            for p in itens:
                ref = f"[{p['referencia']}] " if p.get("referencia") else ""
                alta = " (PRIORIDADE ALTA)" if p["prioridade"] == "alta" else ""
                linhas.append(f"  • {ref}{p['descricao']} → {PARA[p['para']]}{alta}")
            linhas.append("")
        elif cod in d["sem_pendencia"]:
            linhas += [f"{nome.upper()} — nada pendente", ""]
    return assunto, "\n".join(linhas)


# --------------------------------------------------------------------- painel

@router.get("/painel")
def painel(equipe: str | None = None, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    """Tela inicial: última passagem, se falta ciência, pendências abertas."""
    equipes = sorted(e for (e,) in db.query(FtPassagem.equipe).filter(FtPassagem.equipe.isnot(None)).distinct().all())
    recentes = _filtro_equipe(db.query(FtPassagem), equipe).order_by(FtPassagem.data.desc()).limit(6).all()
    ultima = max(recentes, key=_ordem) if recentes else None

    q = db.query(FtPendencia, FtPassagem).join(FtPassagem, FtPendencia.passagem_id == FtPassagem.id).filter(FtPendencia.status == "aberta")
    abertas = _filtro_equipe(q, equipe).all()
    abertas.sort(key=lambda t: (t[0].prioridade != "alta", t[0].para != "proximo_plantao", t[0].criada_em or datetime.min))
    nomes = _nomes(db, _ids_pessoas([a for a, _ in abertas]) | {ps.autor_id for _, ps in abertas})

    contagem = {c: 0 for c in CATEGORIAS}
    for a, _ in abertas:
        contagem[a.categoria] = contagem.get(a.categoria, 0) + 1

    return {
        "equipes": equipes,
        "minha_equipe": user.equipe,
        "sugestao": _sugestao_turno(),
        "ultima": _passagem_dict(db, ultima) if ultima else None,
        "pode_dar_ciencia": bool(ultima and not ultima.ciencia_em and ultima.autor_id != user.id),
        "pendencias": [_pend_dict(a, nomes, ps) for a, ps in abertas],
        "contagem": contagem,
        "gerencia": _gerencia(user),
        "eu": user.id,
    }


@router.get("/historico")
def historico(
    equipe: str | None = None, autor_id: str | None = None,
    de: date | None = None, ate: date | None = None,
    pagina: int = Query(1, ge=1), por_pagina: int = Query(30, ge=5, le=100),
    db: Session = Depends(get_db), user=Depends(REGISTRAR),
):
    q = _filtro_equipe(db.query(FtPassagem), equipe)
    if autor_id:
        q = q.filter(FtPassagem.autor_id == autor_id)
    if de:
        q = q.filter(FtPassagem.data >= de)
    if ate:
        q = q.filter(FtPassagem.data <= ate)
    total = q.count()
    itens = q.order_by(FtPassagem.data.desc(), FtPassagem.turno.desc(), FtPassagem.enviado_em.desc()) \
        .offset((pagina - 1) * por_pagina).limit(por_pagina).all()
    autores = db.query(Colaborador.id, Colaborador.nome).join(FtPassagem, FtPassagem.autor_id == Colaborador.id).distinct().all()
    return {
        "itens": [_passagem_dict(db, p, completa=False) for p in itens],
        "total": total, "paginas": max(1, -(-total // por_pagina)),
        "autores": sorted([{"id": i, "nome": n} for i, n in autores], key=lambda a: a["nome"]),
    }


@router.get("/pendencias")
def listar_pendencias(
    status_: str = Query("aberta", alias="status", pattern="^(aberta|resolvida|todas)$"),
    categoria: str | None = None, para: str | None = None, equipe: str | None = None,
    q: str | None = Query(None, max_length=80), limite: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db), user=Depends(REGISTRAR),
):
    consulta = db.query(FtPendencia, FtPassagem).join(FtPassagem, FtPendencia.passagem_id == FtPassagem.id)
    consulta = _filtro_equipe(consulta, equipe)
    if status_ != "todas":
        consulta = consulta.filter(FtPendencia.status == status_)
    if categoria:
        consulta = consulta.filter(FtPendencia.categoria == categoria)
    if para:
        consulta = consulta.filter(FtPendencia.para == para)
    if q:
        termo = f"%{q.strip().lower()}%"
        consulta = consulta.filter(or_(func.lower(FtPendencia.descricao).like(termo), func.lower(FtPendencia.referencia).like(termo),
                                       func.lower(FtPendencia.resolucao).like(termo)))
    ordem = FtPendencia.resolvida_em.desc() if status_ == "resolvida" else FtPendencia.criada_em.desc()
    linhas = consulta.order_by(ordem).limit(limite).all()
    nomes = _nomes(db, _ids_pessoas([a for a, _ in linhas]) | {ps.autor_id for _, ps in linhas})
    return [_pend_dict(a, nomes, ps) for a, ps in linhas]


@router.get("/indicadores")
def indicadores(dias: int = Query(30, ge=1, le=365), equipe: str | None = None, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    """Visão do gestor no período (dias corridos até hoje)."""
    inicio = date.today() - timedelta(days=dias - 1)
    passagens = _filtro_equipe(db.query(FtPassagem), equipe).filter(FtPassagem.data >= inicio).all()
    com_ciencia = [p for p in passagens if p.ciencia_em and p.enviado_em]
    minutos = [(p.ciencia_em - p.enviado_em).total_seconds() / 60 for p in com_ciencia]

    q = db.query(FtPendencia).join(FtPassagem, FtPendencia.passagem_id == FtPassagem.id)
    q = _filtro_equipe(q, equipe)
    abertas = q.filter(FtPendencia.status == "aberta").all()
    criadas = q.filter(FtPendencia.criada_em >= datetime.combine(inicio, datetime.min.time())).all()
    resolvidas = [p for p in criadas if p.status == "resolvida" and p.resolvida_em and p.criada_em]
    horas = [(p.resolvida_em - p.criada_em).total_seconds() / 3600 for p in resolvidas]

    agora = datetime.utcnow()
    por_cat = {c: {"abertas": 0, "criadas": 0, "resolvidas": 0} for c in CATEGORIAS}
    for p in abertas:
        por_cat[p.categoria]["abertas"] += 1
    for p in criadas:
        por_cat[p.categoria]["criadas"] += 1
        if p.status == "resolvida":
            por_cat[p.categoria]["resolvidas"] += 1

    nomes = _nomes(db, {p.autor_id for p in passagens})
    por_autor: dict = {}
    for p in passagens:
        a = por_autor.setdefault(p.autor_id, {"nome": nomes.get(p.autor_id), "passagens": 0, "pendencias": 0})
        a["passagens"] += 1
    for p in criadas:
        ps = db.get(FtPassagem, p.passagem_id)
        if ps and ps.autor_id in por_autor:
            por_autor[ps.autor_id]["pendencias"] += 1

    return {
        "dias": dias,
        "passagens": len(passagens),
        "sem_ciencia": sum(1 for p in passagens if not p.ciencia_em),
        "ciencia_media_min": round(sum(minutos) / len(minutos)) if minutos else None,
        "pendencias_abertas": len(abertas),
        "abertas_alta": sum(1 for p in abertas if p.prioridade == "alta"),
        "abertas_mais_24h": sum(1 for p in abertas if p.criada_em and agora - p.criada_em > timedelta(hours=24)),
        "abertas_horario_comercial": sum(1 for p in abertas if p.para == "horario_comercial"),
        "criadas": len(criadas),
        "resolvidas": len(resolvidas),
        "resolucao_media_h": round(sum(horas) / len(horas), 1) if horas else None,
        "por_categoria": [{"categoria": c, "nome": CATEGORIAS[c], **v} for c, v in por_cat.items()],
        "por_autor": sorted(por_autor.values(), key=lambda a: a["nome"] or ""),
    }


# ------------------------------------------------------------------ passagem

@router.post("", status_code=201)
def criar(body: PassagemIn, request: Request, tarefas: BackgroundTasks, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    sem = _validar_categorias(body)
    p = FtPassagem(
        autor_id=user.id, equipe=user.equipe, data=body.data, turno=body.turno,
        horario_inicio=body.horario_inicio, horario_fim=body.horario_fim,
        resumo=body.resumo.strip(), recados=_limpo(body.recados), sem_pendencia=sem,
    )
    db.add(p)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Você já registrou a passagem desse plantão — abra no histórico para editar.")
    _aplicar_pendencias(db, p, body, user, editar=False)
    db.commit()
    log_action(db, request, user, "ft_passagem_criar", "ft_passagem", p.id, {"data": str(p.data), "turno": p.turno, "pendencias": len(body.pendencias)})
    d = _passagem_dict(db, p)
    assunto, texto = _texto_email(d)
    tarefas.add_task(_enviar_email, texto, assunto)
    return d


@router.get("/{passagem_id}")
def detalhe(passagem_id: str, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    p = db.get(FtPassagem, passagem_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passagem não encontrada.")
    d = _passagem_dict(db, p)
    d["pode_editar"] = _gerencia(user) or (p.autor_id == user.id and not p.ciencia_em)
    d["pode_dar_ciencia"] = not p.ciencia_em and p.autor_id != user.id
    return d


@router.patch("/{passagem_id}")
def editar(passagem_id: str, body: PassagemIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    p = db.get(FtPassagem, passagem_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passagem não encontrada.")
    if not _gerencia(user):
        if p.autor_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só quem registrou (ou o gestor) pode editar esta passagem.")
        if p.ciencia_em:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "O próximo plantão já deu ciência — peça ao gestor para corrigir, ou comente na pendência.")
    p.sem_pendencia = _validar_categorias(body)
    p.data, p.turno = body.data, body.turno
    p.horario_inicio, p.horario_fim = body.horario_inicio, body.horario_fim
    p.resumo, p.recados = body.resumo.strip(), _limpo(body.recados)
    p.editado_em = datetime.utcnow()
    _aplicar_pendencias(db, p, body, user, editar=True)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma passagem sua nesse dia e turno.")
    log_action(db, request, user, "ft_passagem_editar", "ft_passagem", p.id, {"pendencias": len(body.pendencias)})
    return _passagem_dict(db, p)


@router.delete("/{passagem_id}")
def excluir(passagem_id: str, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    p = db.get(FtPassagem, passagem_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passagem não encontrada.")
    n = db.query(FtPendencia).filter(FtPendencia.passagem_id == p.id).delete()
    info = {"autor_id": p.autor_id, "data": str(p.data), "turno": p.turno, "pendencias_apagadas": n}
    db.delete(p)
    db.commit()
    log_action(db, request, user, "ft_passagem_excluir", "ft_passagem", passagem_id, info)
    return {"ok": True}


@router.post("/{passagem_id}/ciencia")
def dar_ciencia(passagem_id: str, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    p = db.get(FtPassagem, passagem_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passagem não encontrada.")
    if p.autor_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A ciência é de quem assume o próximo plantão.")
    if p.ciencia_em:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ciência já registrada.")
    p.ciencia_por_id, p.ciencia_em = user.id, datetime.utcnow()
    db.commit()
    log_action(db, request, user, "ft_passagem_ciencia", "ft_passagem", p.id)
    return _passagem_dict(db, p)


# ---------------------------------------------------------------- pendências

def _pendencia(db: Session, pend_id: str) -> FtPendencia:
    x = db.get(FtPendencia, pend_id)
    if not x:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pendência não encontrada.")
    return x


def _resposta_pendencia(db: Session, x: FtPendencia) -> dict:
    ps = db.get(FtPassagem, x.passagem_id)
    return _pend_dict(x, _nomes(db, _ids_pessoas([x]) | {ps.autor_id if ps else None}), ps)


def _anotar(x: FtPendencia, user, texto: str):
    # lista nova (não .append) para o SQLAlchemy perceber a mudança no JSON
    x.historico = (x.historico or []) + [{"em": datetime.utcnow().isoformat(timespec="seconds"), "por_id": user.id, "texto": texto}]


@router.post("/pendencias/{pend_id}/resolver")
def resolver(pend_id: str, body: PendenciaAcaoIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    x = _pendencia(db, pend_id)
    texto = (body.texto or "").strip()
    if len(texto) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Conte rapidamente como foi resolvido.")
    if x.status == "resolvida":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta pendência já foi resolvida.")
    x.status, x.resolucao = "resolvida", texto
    x.resolvida_por_id, x.resolvida_em = user.id, datetime.utcnow()
    db.commit()
    log_action(db, request, user, "ft_pendencia_resolver", "ft_pendencia", x.id)
    return _resposta_pendencia(db, x)


@router.post("/pendencias/{pend_id}/reabrir")
def reabrir(pend_id: str, body: PendenciaAcaoIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    x = _pendencia(db, pend_id)
    if x.status != "resolvida":
        raise HTTPException(status.HTTP_409_CONFLICT, "A pendência já está aberta.")
    _anotar(x, user, f"Reaberta (solução anterior: {x.resolucao or '—'})" + (f" — {body.texto.strip()}" if body.texto and body.texto.strip() else ""))
    x.status, x.resolucao, x.resolvida_por_id, x.resolvida_em = "aberta", None, None, None
    db.commit()
    log_action(db, request, user, "ft_pendencia_reabrir", "ft_pendencia", x.id)
    return _resposta_pendencia(db, x)


@router.post("/pendencias/{pend_id}/comentar")
def comentar(pend_id: str, body: PendenciaAcaoIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    x = _pendencia(db, pend_id)
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escreva o comentário.")
    _anotar(x, user, texto)
    db.commit()
    return _resposta_pendencia(db, x)
