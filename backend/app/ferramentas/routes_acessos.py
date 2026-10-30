"""Acessos do setor — rotas sob /ferramentas/acessos.

Fica dentro do prefixo /ferramentas, que já está liberado no Nginx: não
precisa mexer no escala.conf.

Estrutura: Seção > Item (sistema, link ou tipo de equipamento) > linhas de
acesso (usuário e/ou senha + observação).

Regras:
  - "acessos.usar": vê tudo, revela/copia senhas, inclui itens e linhas, e
    altera/exclui SÓ o que a própria pessoa cadastrou (posse por linha: dá
    para acrescentar uma senha no item de outra pessoa, mas não mexer nas
    linhas dela).
  - "acessos.gerenciar" (e o admin do Escala, que tem tudo): altera qualquer
    item/linha e organiza as seções (criar, renomear, ordenar, excluir vazia).
  - Senha nunca vem nas listagens; sai só por POST /credenciais/{id}/revelar,
    com limite por minuto e registro no audit_log.
  - Exclusão é lógica (excluido_em): dá para recuperar pelo banco.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import log_action
from app.core.rate_limit import limiter
from app.db.models import Colaborador
from app.db.session import get_db
from app.ferramentas import normalizar as nz
from app.ferramentas.models import FtAcessoCred, FtAcessoItem, FtAcessoSecao
from app.ferramentas.schemas import (
    AcessoCredIn, AcessoCredPatch, AcessoItemIn, AcessoItemPatch, AcessoSecaoIn, AcessoSecaoPatch,
)
from app.ferramentas.seguranca import cifrar, decifrar, exigir

USAR, GERENCIAR = exigir("acessos.usar"), exigir("acessos.gerenciar")

router = APIRouter(prefix="/acessos", tags=["ferramentas · acessos do setor"])


# ------------------------------------------------------------------ helpers

def _gerencia(user) -> bool:
    return "acessos.gerenciar" in user.ft_permissoes


def _pode(user, obj) -> bool:
    return _gerencia(user) or (obj.criado_por_id is not None and obj.criado_por_id == user.id)


def _exigir_dono(user, obj, oque: str):
    if not _pode(user, obj):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Você só pode alterar {oque} que você cadastrou. Peça a um administrador.")


def _nomes(db: Session, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {c.id: c.nome for c in db.query(Colaborador).filter(Colaborador.id.in_(ids)).all()}


def _link(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _texto_livre(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _secao(db: Session, secao_id: str) -> FtAcessoSecao:
    s = db.get(FtAcessoSecao, secao_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seção não encontrada.")
    return s


def _item(db: Session, item_id: str) -> FtAcessoItem:
    i = db.get(FtAcessoItem, item_id)
    if not i or i.excluido_em:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item não encontrado.")
    return i


def _cred(db: Session, cred_id: str) -> FtAcessoCred:
    c = db.get(FtAcessoCred, cred_id)
    if not c or c.excluido_em:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acesso não encontrado.")
    item = db.get(FtAcessoItem, c.item_id)
    if not item or item.excluido_em:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acesso não encontrado.")
    return c


def _creds_ativas(db: Session, item_id: str):
    return (db.query(FtAcessoCred)
            .filter(FtAcessoCred.item_id == item_id, FtAcessoCred.excluido_em.is_(None))
            .order_by(FtAcessoCred.ordem, FtAcessoCred.criado_em).all())


# ------------------------------------------------------------- listagem

@router.get("")
def listar(db: Session = Depends(get_db), user=Depends(USAR)):
    secoes = db.query(FtAcessoSecao).order_by(FtAcessoSecao.ordem, FtAcessoSecao.nome).all()
    itens = (db.query(FtAcessoItem).filter(FtAcessoItem.excluido_em.is_(None))
             .order_by(FtAcessoItem.ordem, FtAcessoItem.nome).all())
    # contagem de linhas por item (e quantas têm senha), sem decifrar nada
    contagem = {}
    for item_id, tem_senha, n in (db.query(FtAcessoCred.item_id, FtAcessoCred.senha_cifrada.isnot(None), func.count())
                                  .filter(FtAcessoCred.excluido_em.is_(None))
                                  .group_by(FtAcessoCred.item_id, FtAcessoCred.senha_cifrada.isnot(None)).all()):
        c = contagem.setdefault(item_id, {"linhas": 0, "senhas": 0})
        c["linhas"] += n
        if tem_senha:
            c["senhas"] += n
    por_secao = {}
    for i in itens:
        c = contagem.get(i.id, {"linhas": 0, "senhas": 0})
        por_secao.setdefault(i.secao_id, []).append({
            "id": i.id, "nome": i.nome, "link": i.link, "descricao": i.descricao,
            "linhas": c["linhas"], "senhas": c["senhas"], "pode_editar": _pode(user, i),
        })
    return {
        "secoes": [{"id": s.id, "nome": s.nome, "tipo": s.tipo, "ordem": s.ordem, "itens": por_secao.get(s.id, [])}
                   for s in secoes],
        "gerencia": _gerencia(user),
    }


@router.get("/itens/{item_id}")
def ver_item(item_id: str, db: Session = Depends(get_db), user=Depends(USAR)):
    i = _item(db, item_id)
    sec = db.get(FtAcessoSecao, i.secao_id)
    creds = _creds_ativas(db, i.id)
    nomes = _nomes(db, {i.criado_por_id, i.atualizado_por_id} | {c.criado_por_id for c in creds})
    return {
        "id": i.id, "secao_id": i.secao_id, "secao_nome": sec.nome if sec else None,
        "secao_tipo": sec.tipo if sec else "links", "nome": i.nome, "link": i.link, "descricao": i.descricao,
        "criado_por_nome": nomes.get(i.criado_por_id), "criado_em": i.criado_em, "atualizado_em": i.atualizado_em,
        "pode_editar": _pode(user, i),
        "credenciais": [{
            "id": c.id, "usuario": c.usuario, "rotulo": c.rotulo, "tem_senha": bool(c.senha_cifrada),
            "criado_por_nome": nomes.get(c.criado_por_id), "minha": c.criado_por_id == user.id,
            "pode_editar": _pode(user, c), "criado_em": c.criado_em,
        } for c in creds],
    }


# ---------------------------------------------------------------- seções

@router.post("/secoes", status_code=201)
def criar_secao(body: AcessoSecaoIn, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    nome = nz.texto(body.nome)
    if db.query(FtAcessoSecao).filter(func.lower(FtAcessoSecao.nome) == nome.lower()).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma seção com esse nome.")
    ordem = (db.query(func.max(FtAcessoSecao.ordem)).scalar() or 0) + 1
    s = FtAcessoSecao(nome=nome, tipo=body.tipo, ordem=ordem)
    db.add(s)
    db.commit()
    log_action(db, request, user, "ft_acesso_secao_criar", "ft_acesso_secao", s.id, {"nome": nome})
    return {"id": s.id}


@router.patch("/secoes/{secao_id}")
def editar_secao(secao_id: str, body: AcessoSecaoPatch, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    s = _secao(db, secao_id)
    dados = body.model_dump(exclude_unset=True)
    if dados.get("nome"):
        nome = nz.texto(dados["nome"])
        outra = db.query(FtAcessoSecao).filter(func.lower(FtAcessoSecao.nome) == nome.lower(), FtAcessoSecao.id != s.id).first()
        if outra:
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma seção com esse nome.")
        s.nome = nome
    if dados.get("tipo"):
        s.tipo = dados["tipo"]
    if dados.get("ordem") is not None:
        s.ordem = dados["ordem"]
    db.commit()
    log_action(db, request, user, "ft_acesso_secao_editar", "ft_acesso_secao", s.id, dados)
    return {"ok": True}


@router.delete("/secoes/{secao_id}")
def excluir_secao(secao_id: str, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    s = _secao(db, secao_id)
    if db.query(FtAcessoItem).filter(FtAcessoItem.secao_id == s.id, FtAcessoItem.excluido_em.is_(None)).count():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A seção ainda tem itens. Mova ou exclua os itens antes.")
    nome = s.nome
    # itens já excluídos (que continuam no banco) deixam de apontar para a seção
    db.query(FtAcessoItem).filter(FtAcessoItem.secao_id == s.id).update({"secao_id": None}, synchronize_session=False)
    db.delete(s)
    db.commit()
    log_action(db, request, user, "ft_acesso_secao_excluir", "ft_acesso_secao", secao_id, {"nome": nome})
    return {"ok": True}


# ----------------------------------------------------------------- itens

@router.post("/itens", status_code=201)
@limiter.limit("30/minute")
def criar_item(body: AcessoItemIn, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    sec = _secao(db, body.secao_id)
    nome = nz.texto(body.nome)
    if not nome:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o nome.")
    ordem = (db.query(func.max(FtAcessoItem.ordem)).filter(FtAcessoItem.secao_id == sec.id).scalar() or 0) + 1
    i = FtAcessoItem(secao_id=sec.id, nome=nome, link=_link(body.link), descricao=_texto_livre(body.descricao),
                     ordem=ordem, criado_por_id=user.id, atualizado_por_id=user.id)
    db.add(i)
    db.commit()
    log_action(db, request, user, "ft_acesso_item_criar", "ft_acesso_item", i.id, {"nome": nome, "secao": sec.nome})
    return {"id": i.id}


@router.patch("/itens/{item_id}")
def editar_item(item_id: str, body: AcessoItemPatch, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    i = _item(db, item_id)
    _exigir_dono(user, i, "os itens")
    dados = body.model_dump(exclude_unset=True)
    if dados.get("secao_id"):
        i.secao_id = _secao(db, dados["secao_id"]).id
    if "nome" in dados:
        nome = nz.texto(dados["nome"])
        if not nome:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "O nome não pode ficar vazio.")
        i.nome = nome
    if "link" in dados:
        i.link = _link(dados["link"])
    if "descricao" in dados:
        i.descricao = _texto_livre(dados["descricao"])
    i.atualizado_por_id = user.id
    i.atualizado_em = datetime.utcnow()
    db.commit()
    log_action(db, request, user, "ft_acesso_item_editar", "ft_acesso_item", i.id,
               {"nome": i.nome, "campos": sorted(dados), "de_outro": i.criado_por_id != user.id})
    return {"ok": True}


@router.delete("/itens/{item_id}")
def excluir_item(item_id: str, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    i = _item(db, item_id)
    _exigir_dono(user, i, "os itens")
    if not _gerencia(user) and any(c.criado_por_id != user.id for c in _creds_ativas(db, i.id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Este item tem acessos cadastrados por outras pessoas. Só um administrador pode excluí-lo.")
    agora = datetime.utcnow()
    i.excluido_em, i.excluido_por_id = agora, user.id
    db.commit()
    log_action(db, request, user, "ft_acesso_item_excluir", "ft_acesso_item", i.id, {"nome": i.nome})
    return {"ok": True}


# -------------------------------------------------------- linhas de acesso

@router.post("/itens/{item_id}/credenciais", status_code=201)
@limiter.limit("30/minute")
def criar_cred(item_id: str, body: AcessoCredIn, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    i = _item(db, item_id)
    usuario = (body.usuario or "").strip() or None
    if not usuario and not body.senha:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o usuário, a senha ou os dois.")
    ordem = (db.query(func.max(FtAcessoCred.ordem)).filter(FtAcessoCred.item_id == i.id).scalar() or 0) + 1
    c = FtAcessoCred(item_id=i.id, usuario=usuario, senha_cifrada=cifrar(body.senha), rotulo=nz.texto(body.rotulo),
                     ordem=ordem, criado_por_id=user.id, atualizado_por_id=user.id)
    db.add(c)
    db.commit()
    log_action(db, request, user, "ft_acesso_cred_criar", "ft_acesso_cred", c.id, {"item": i.nome, "usuario": usuario})
    return {"id": c.id}


@router.patch("/credenciais/{cred_id}")
def editar_cred(cred_id: str, body: AcessoCredPatch, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    c = _cred(db, cred_id)
    _exigir_dono(user, c, "os acessos")
    dados = body.model_dump(exclude_unset=True)
    if "usuario" in dados:
        c.usuario = (dados["usuario"] or "").strip() or None
    if "rotulo" in dados:
        c.rotulo = nz.texto(dados["rotulo"])
    if "senha" in dados:
        c.senha_cifrada = cifrar(dados["senha"])
    if not c.usuario and not c.senha_cifrada:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A linha precisa de usuário ou senha.")
    c.atualizado_por_id = user.id
    c.atualizado_em = datetime.utcnow()
    db.commit()
    log_action(db, request, user, "ft_acesso_cred_editar", "ft_acesso_cred", c.id,
               {"campos": sorted(dados), "de_outro": c.criado_por_id != user.id})
    return {"ok": True}


@router.delete("/credenciais/{cred_id}")
def excluir_cred(cred_id: str, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    c = _cred(db, cred_id)
    _exigir_dono(user, c, "os acessos")
    c.excluido_em, c.excluido_por_id = datetime.utcnow(), user.id
    db.commit()
    log_action(db, request, user, "ft_acesso_cred_excluir", "ft_acesso_cred", c.id,
               {"usuario": c.usuario, "de_outro": c.criado_por_id != user.id})
    return {"ok": True}


@router.post("/credenciais/{cred_id}/revelar")
@limiter.limit("30/minute")
def revelar(cred_id: str, request: Request, db: Session = Depends(get_db), user=Depends(USAR)):
    c = _cred(db, cred_id)
    senha = decifrar(c.senha_cifrada)
    log_action(db, request, user, "ft_acesso_revelar", "ft_acesso_cred", c.id, {"item_id": c.item_id, "usuario": c.usuario})
    return {"senha": senha}
