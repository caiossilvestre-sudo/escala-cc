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
import base64
import os
import smtplib
from pathlib import Path
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
from app.ferramentas import fotos
from app.ferramentas.models import FtAnexo, FtPassagem, FtPendencia
from app.ferramentas.schemas import AnexoIn, PassagemIn, PendenciaAcaoIn
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


# ------------------------------------------------------------------ anexos

LARGURA_PRINT = 1920   # print de tela precisa de mais resolução que a foto da câmera
QUALIDADE_PRINT = 85
SOLTO_MAX_HORAS = 24   # anexo que subiu e nunca foi vinculado é apagado depois disso


def _pasta_anexos() -> Path:
    pasta = fotos.pasta_fotos() / "passagem"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def _arquivo(a: FtAnexo) -> Path:
    nome = "".join(ch for ch in a.arquivo if ch.isalnum() or ch in "-.")
    return _pasta_anexos() / nome


def _apagar_anexos(db: Session, anexos):
    for a in anexos:
        try:
            _arquivo(a).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(a)


def _mapa_anexos(db: Session, pend_ids) -> dict:
    """{pendencia_id: [anexo, ...]} de uma vez só (evita uma consulta por pendência)."""
    ids = [i for i in pend_ids if i]
    mapa: dict = {}
    if ids:
        for a in db.query(FtAnexo).filter(FtAnexo.pendencia_id.in_(ids)).order_by(FtAnexo.criado_em).all():
            mapa.setdefault(a.pendencia_id, []).append(a)
    return mapa


def _anexo_resumo(a: FtAnexo) -> dict:
    return {"id": a.id, "nome": a.nome, "contexto": a.contexto, "bytes": a.bytes}


def _vincular(db: Session, ids, user, *, passagem_id=None, pendencia_id=None, contexto: str) -> list[str]:
    """Liga anexos soltos (enviados pela própria pessoa) a uma passagem/pendência.
    Os que já estavam ligados no mesmo lugar ficam como estão."""
    ligados = []
    for aid in dict.fromkeys(ids or []):
        a = db.get(FtAnexo, aid)
        if not a:
            continue
        mesmo_lugar = a.contexto == contexto and a.passagem_id == passagem_id and a.pendencia_id == pendencia_id
        if not mesmo_lugar:
            if a.contexto is not None or a.criado_por_id != user.id:
                continue  # não deixa "roubar" anexo de outro registro
            a.passagem_id, a.pendencia_id, a.contexto = passagem_id, pendencia_id, contexto
        ligados.append(a.id)
    return ligados


def _sincronizar(db: Session, ids, user, *, passagem_id=None, pendencia_id=None, contexto: str):
    """Edição: o que ficou na lista é vinculado; o que saiu é apagado."""
    manter = set(_vincular(db, ids, user, passagem_id=passagem_id, pendencia_id=pendencia_id, contexto=contexto))
    q = db.query(FtAnexo).filter(FtAnexo.contexto == contexto)
    q = q.filter(FtAnexo.pendencia_id == pendencia_id) if pendencia_id else q.filter(FtAnexo.passagem_id == passagem_id, FtAnexo.pendencia_id.is_(None))
    _apagar_anexos(db, [a for a in q.all() if a.id not in manter])


def _pend_dict(p: FtPendencia, nomes: dict, passagem: FtPassagem | None = None, anexos: dict | None = None) -> dict:
    return {
        "id": p.id, "passagem_id": p.passagem_id, "categoria": p.categoria,
        "referencia": p.referencia, "descricao": p.descricao, "para": p.para,
        "prioridade": p.prioridade, "link": p.link, "status": p.status,
        "criada_em": p.criada_em, "criada_por": nomes.get(p.criada_por_id), "criada_por_id": p.criada_por_id,
        "resolvida_em": p.resolvida_em, "resolvida_por": nomes.get(p.resolvida_por_id),
        "resolucao": p.resolucao,
        "historico": [{**h, "por": nomes.get(h.get("por_id"))} for h in (p.historico or [])],
        "origem": {"data": passagem.data, "turno": passagem.turno, "autor": nomes.get(passagem.autor_id)} if passagem else None,
        "anexos": [_anexo_resumo(a) for a in (anexos or {}).get(p.id, [])],
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
    anexos = _mapa_anexos(db, [x.id for x in pends]) if completa else {}
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
        proprios = db.query(FtAnexo).filter(FtAnexo.passagem_id == p.id, FtAnexo.contexto == "passagem").order_by(FtAnexo.criado_em).all()
        base.update({"resumo": p.resumo, "recados": p.recados, "anexos": [_anexo_resumo(a) for a in proprios],
                     "pendencias": [_pend_dict(x, nomes, anexos=anexos) for x in pends]})
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
        dados = {k: (v if k == "anexos" else _limpo(v)) for k, v in item.model_dump(exclude={"id"}).items()}
        if dados["link"] and not dados["link"].lower().startswith(("http://", "https://")):
            dados["link"] = "https://" + dados["link"]
        anexos = dados.pop("anexos", None) or []
        alvo = existentes.get(item.id) if item.id else None
        if alvo:
            vistos.add(alvo.id)
            for k, v in dados.items():
                setattr(alvo, k, v)
            _sincronizar(db, anexos, user, passagem_id=passagem.id, pendencia_id=alvo.id, contexto="pendencia")
        else:
            nova = FtPendencia(passagem_id=passagem.id, criada_por_id=user.id, historico=[], **dados)
            db.add(nova)
            db.flush()
            _vincular(db, anexos, user, passagem_id=passagem.id, pendencia_id=nova.id, contexto="pendencia")
    # na edição, item que saiu da lista é removido (só os ainda abertos;
    # pendência já resolvida fica como histórico)
    for pid, x in existentes.items():
        if pid not in vistos and x.status == "aberta":
            _apagar_anexos(db, db.query(FtAnexo).filter(FtAnexo.pendencia_id == x.id).all())
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

    mapa = _mapa_anexos(db, [a.id for a, _ in abertas])
    contagem = {c: 0 for c in CATEGORIAS}
    for a, _ in abertas:
        contagem[a.categoria] = contagem.get(a.categoria, 0) + 1

    return {
        "equipes": equipes,
        "minha_equipe": user.equipe,
        "sugestao": _sugestao_turno(),
        "ultima": _passagem_dict(db, ultima) if ultima else None,
        "pode_dar_ciencia": bool(ultima and not ultima.ciencia_em and ultima.autor_id != user.id),
        "pendencias": [_pend_dict(a, nomes, ps, mapa) for a, ps in abertas],
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
    mapa = _mapa_anexos(db, [a.id for a, _ in linhas])
    return [_pend_dict(a, nomes, ps, mapa) for a, ps in linhas]


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


# ------------------------------------------------------------- anexos (rotas)

@router.post("/anexos", status_code=201)
def enviar_anexo(body: AnexoIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    """Sobe um print/imagem. Volta o id, que vai junto ao salvar a passagem,
    a pendência, o comentário ou a baixa."""
    from PIL import Image, UnidentifiedImageError
    import io

    bruto = fotos.decodificar_base64(body.imagem_base64)
    try:
        img = Image.open(io.BytesIO(bruto))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O arquivo enviado não é uma imagem válida.")
    img = img.convert("RGB")
    if img.width > LARGURA_PRINT:
        img = img.resize((LARGURA_PRINT, round(img.height * LARGURA_PRINT / img.width)), Image.LANCZOS)
    saida = io.BytesIO()
    img.save(saida, format="JPEG", quality=QUALIDADE_PRINT, optimize=True)
    jpeg = saida.getvalue()

    # limpeza: anexos soltos antigos (subiram mas a passagem nunca foi enviada)
    velhos = db.query(FtAnexo).filter(FtAnexo.contexto.is_(None), FtAnexo.criado_em < datetime.utcnow() - timedelta(hours=SOLTO_MAX_HORAS)).all()
    if velhos:
        _apagar_anexos(db, velhos)

    a = FtAnexo(arquivo="", nome=(body.nome or "print").strip()[:200], bytes=len(jpeg),
                largura=img.width, altura=img.height, criado_por_id=user.id)
    db.add(a)
    db.flush()
    a.arquivo = f"{a.id}.jpg"
    destino = _arquivo(a)
    temp = destino.with_suffix(".tmp")
    temp.write_bytes(jpeg)
    temp.replace(destino)
    db.commit()
    return _anexo_resumo(a)


@router.get("/anexos/{anexo_id}")
def ver_anexo(anexo_id: str, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    a = db.get(FtAnexo, anexo_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
    if a.contexto is None and a.criado_por_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
    try:
        dado = base64.b64encode(_arquivo(a).read_bytes()).decode("ascii")
    except OSError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo do anexo não está mais no servidor.")
    return {"id": a.id, "nome": a.nome, "imagem_base64": f"data:image/jpeg;base64,{dado}",
            "largura": a.largura, "altura": a.altura, "bytes": a.bytes, "criado_em": a.criado_em,
            "criado_por": _nomes(db, {a.criado_por_id}).get(a.criado_por_id)}


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
    _vincular(db, body.anexos, user, passagem_id=p.id, contexto="passagem")
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
    _sincronizar(db, body.anexos, user, passagem_id=p.id, contexto="passagem")
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
    pend_ids = [i for (i,) in db.query(FtPendencia.id).filter(FtPendencia.passagem_id == p.id).all()]
    _apagar_anexos(db, db.query(FtAnexo).filter(or_(FtAnexo.passagem_id == p.id, FtAnexo.pendencia_id.in_(pend_ids or [""]))).all())
    db.flush()
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
    return _pend_dict(x, _nomes(db, _ids_pessoas([x]) | {ps.autor_id if ps else None}), ps, _mapa_anexos(db, [x.id]))


def _anotar(x: FtPendencia, user, texto: str, anexos: list[str] | None = None):
    # lista nova (não .append) para o SQLAlchemy perceber a mudança no JSON
    item = {"em": datetime.utcnow().isoformat(timespec="seconds"), "por_id": user.id, "texto": texto}
    if anexos:
        item["anexos"] = anexos
    x.historico = (x.historico or []) + [item]


@router.post("/pendencias/{pend_id}/resolver")
def resolver(pend_id: str, body: PendenciaAcaoIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    x = _pendencia(db, pend_id)
    texto = (body.texto or "").strip()
    if len(texto) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Conte rapidamente como foi resolvido.")
    if x.status == "resolvida":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta pendência já foi resolvida.")
    _vincular(db, body.anexos, user, passagem_id=x.passagem_id, pendencia_id=x.id, contexto="resolucao")
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


@router.delete("/pendencias/{pend_id}")
def excluir_pendencia(pend_id: str, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    """Card lançado errado. Quem criou exclui o próprio (enquanto estiver aberto);
    o gestor exclui qualquer um. Os prints vão junto; fica na auditoria."""
    x = _pendencia(db, pend_id)
    if not _gerencia(user):
        if x.criada_por_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só quem criou a pendência (ou o gestor) pode excluí-la.")
        if x.status != "aberta":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Pendência já resolvida — peça ao gestor para excluir.")
    copia = {"categoria": x.categoria, "referencia": x.referencia, "descricao": x.descricao, "status": x.status,
             "passagem_id": x.passagem_id, "criada_por_id": x.criada_por_id}
    _apagar_anexos(db, db.query(FtAnexo).filter(FtAnexo.pendencia_id == x.id).all())
    db.flush()
    db.delete(x)
    db.commit()
    log_action(db, request, user, "ft_pendencia_excluir", "ft_pendencia", pend_id, copia)
    return {"ok": True}


@router.post("/pendencias/{pend_id}/comentar")
def comentar(pend_id: str, body: PendenciaAcaoIn, request: Request, db: Session = Depends(get_db), user=Depends(REGISTRAR)):
    x = _pendencia(db, pend_id)
    texto = (body.texto or "").strip()
    if not texto and not body.anexos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escreva o comentário ou anexe um print.")
    ligados = _vincular(db, body.anexos, user, passagem_id=x.passagem_id, pendencia_id=x.id, contexto="comentario")
    _anotar(x, user, texto, ligados)
    db.commit()
    return _resposta_pendencia(db, x)


# ------------------------------------------------- lembretes pelo Teams
#
# Rodam junto com o lembrete de intervalo: toda vez que o Power Automate
# consulta GET /avisos/pendentes-teams (a cada 5 min), estas funções criam os
# avisos que estiverem na hora. Cada aviso sai uma vez só por pessoa/plantão.
#
#   passagem_registrar -> 30 min antes do FIM do plantão: "registre a passagem"
#                         (não sai se a passagem daquele plantão já foi enviada)
#   passagem_entrada   -> no INÍCIO do plantão: resumo das pendências abertas
#                         (também aparece no pop-up de avisos ao entrar no sistema)
#
# Quem recebe: plantonistas = quem tem "Registrar / baixar" da Passagem e NÃO
# tem "Gestor" (o gestor não trabalha em plantão). Quando a pessoa está
# trabalhando sai da mesma regra do lembrete de intervalo (plantão do dia,
# ciclo 12x36, folga/atestado/férias cancelam).
#
# .env (opcionais):
#   PASSAGEM_LEMBRETES=0           desliga os dois lembretes
#   PASSAGEM_LEMBRETE_MIN=30       antecedência do lembrete de registrar
#   PASSAGEM_LINK=https://...      endereço do sistema na mensagem
#                                  (padrão: FRONTEND_ORIGIN)

JANELA_ENTRADA_MIN = 30  # o aviso de entrada pode sair até 30 min depois do início


def _plantonistas(db: Session) -> list[Colaborador]:
    from app.ferramentas.models import FtAcesso
    from app.ferramentas.seguranca import normalizar_permissoes
    ids = []
    for a in db.query(FtAcesso).all():
        perms = normalizar_permissoes(a.permissoes)
        if "passagem.registrar" in perms and "passagem.gerenciar" not in perms:
            ids.append(a.colaborador_id)
    if not ids:
        return []
    return db.query(Colaborador).filter(
        Colaborador.id.in_(ids), Colaborador.status == "ativo",
        Colaborador.role.in_(("colaborador", "supervisor", "ferramentas")),
    ).all()


def _hm(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def _turnos_da_pessoa(db: Session, c: Colaborador, dia: date) -> list[tuple[datetime, datetime, str, str]]:
    """Plantões que COMEÇAM em `dia`: [(início, fim, "07:00", "19:00")], em horário local."""
    from app.api.routes_avisos import _esta_de_servico
    from app.db.models import Plantao

    horarios = [(p.horario_inicio, p.horario_fim) for p in db.query(Plantao).filter(Plantao.colaborador_id == c.id, Plantao.data == dia).all()]
    if not horarios and c.horario_inicio and c.horario_fim:
        horarios = [(c.horario_inicio, c.horario_fim)]
    turnos = []
    for ini, fim in horarios:
        try:
            if not _esta_de_servico(db, c, dia, _hm(ini)):
                continue
            inicio = datetime.combine(dia, datetime.strptime(ini, "%H:%M").time(), tzinfo=FUSO)
            final = datetime.combine(dia, datetime.strptime(fim, "%H:%M").time(), tzinfo=FUSO)
        except (ValueError, TypeError):
            continue
        if final <= inicio:
            final += timedelta(days=1)  # vira a noite (19:00–07:00)
        turnos.append((inicio, final, ini, fim))
    return turnos


def _link() -> str:
    base = (os.getenv("PASSAGEM_LINK") or settings.frontend_origin or "").rstrip("/")
    return f"{base}/#ft-passagem" if base else ""


def _ja_avisado(db: Session, colaborador_id: str, tipo: str, dia: date) -> bool:
    """Um aviso de cada tipo por pessoa por plantão (data = dia em que o plantão começou)."""
    from app.db.models import Aviso
    return db.query(Aviso).filter(Aviso.colaborador_id == colaborador_id, Aviso.tipo == tipo, Aviso.data == dia).first() is not None


def _mensagem_entrada(db: Session, c: Colaborador, fim_txt: str) -> str:
    q = db.query(FtPendencia, FtPassagem).join(FtPassagem, FtPendencia.passagem_id == FtPassagem.id).filter(FtPendencia.status == "aberta")
    if c.equipe:
        q = q.filter(or_(FtPassagem.equipe == c.equipe, FtPassagem.equipe.is_(None)))
    abertas = [p for p, _ in q.all()]
    ultima_q = db.query(FtPassagem)
    if c.equipe:
        ultima_q = ultima_q.filter(FtPassagem.equipe == c.equipe)
    recentes = ultima_q.order_by(FtPassagem.data.desc()).limit(6).all()
    ultima = max(recentes, key=_ordem) if recentes else None

    linhas = [f"Bom plantão, {c.nome.split()[0]}! (até {fim_txt})"]
    if ultima and ultima.autor_id != c.id:
        autor = _nomes(db, {ultima.autor_id}).get(ultima.autor_id, "—")
        situacao = "aguardando sua ciência" if not ultima.ciencia_em else "já com ciência"
        linhas.append(f"Última passagem: {autor} · {TURNO.get(ultima.turno, ultima.turno).lower()} {ultima.data.strftime('%d/%m')} — {situacao}.")
        if ultima.recados:
            linhas.append(f"Recado: {ultima.recados[:300]}")
    elif not ultima:
        linhas.append("Ainda não há passagem registrada.")

    if not abertas:
        linhas.append("✅ Nenhuma pendência aberta.")
    else:
        alta = sum(1 for p in abertas if p.prioridade == "alta")
        prox = [p for p in abertas if p.para == "proximo_plantao"]
        partes = [f"{len(abertas)} pendência(s) aberta(s)"]
        if prox:
            partes.append(f"{len(prox)} para este plantão")
        if alta:
            partes.append(f"{alta} de prioridade alta")
        linhas.append("📋 " + " · ".join(partes) + ":")
        ordem = sorted(abertas, key=lambda p: (p.prioridade != "alta", p.para != "proximo_plantao", p.criada_em or datetime.min))
        for p in ordem[:6]:
            ref = f"{p.referencia} — " if p.referencia else ""
            marca = "❗ " if p.prioridade == "alta" else "• "
            linhas.append(f"{marca}[{CATEGORIAS.get(p.categoria, p.categoria)}] {ref}{p.descricao[:140]}")
        if len(ordem) > 6:
            linhas.append(f"…e mais {len(ordem) - 6}.")
    if _link():
        linhas.append(f"Ver e dar ciência: {_link()}")
    return "\n".join(linhas)


def gerar_lembretes_passagem(db: Session, agora: datetime | None = None) -> int:
    from app.db.models import Aviso

    if os.getenv("PASSAGEM_LEMBRETES", "1").strip() in ("0", "false", "nao", "não"):
        return 0
    try:
        antecedencia = max(5, min(180, int(os.getenv("PASSAGEM_LEMBRETE_MIN", "30"))))
    except ValueError:
        antecedencia = 30
    agora = agora or datetime.now(FUSO)
    hoje = agora.date()
    criados = 0
    for c in _plantonistas(db):
        for dia in (hoje - timedelta(days=1), hoje):
            for inicio, fim, ini_txt, fim_txt in _turnos_da_pessoa(db, c, dia):
                marca = f"({ini_txt}–{fim_txt})"

                # 1) 30 min antes de terminar: registrar a passagem
                if fim - timedelta(minutes=antecedencia) <= agora < fim and not _ja_avisado(db, c.id, "passagem_registrar", dia):
                    turno = "noturno" if inicio.hour >= 12 else "diurno"
                    enviada = db.query(FtPassagem).filter(FtPassagem.autor_id == c.id, FtPassagem.data == dia, FtPassagem.turno == turno).first()
                    if not enviada:
                        texto = f"📝 Seu plantão {marca} termina às {fim_txt}. Registre a passagem de plantão: o que houve e o que ficou pendente (PRTG, IXC, Zammad, Projetos)."
                        if _link():
                            texto += f"\n{_link()}"
                        db.add(Aviso(colaborador_id=c.id, tipo="passagem_registrar", data=dia, canais=[], lido=True,
                                     lido_via="automatico", lido_em=datetime.utcnow(), mensagem=texto))
                        criados += 1

                # 2) na entrada: o que está pendente (também vira pop-up no sistema)
                if inicio <= agora < inicio + timedelta(minutes=JANELA_ENTRADA_MIN) and not _ja_avisado(db, c.id, "passagem_entrada", dia):
                    texto = _mensagem_entrada(db, c, fim_txt)
                    db.add(Aviso(colaborador_id=c.id, tipo="passagem_entrada", data=dia, canais=[], mensagem=texto))
                    criados += 1
    if criados:
        db.commit()
    return criados
