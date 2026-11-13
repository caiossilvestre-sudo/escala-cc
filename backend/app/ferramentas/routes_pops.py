"""Procedimentos (POPs) — rotas sob /ferramentas/pops.

Dentro do prefixo /ferramentas, já liberado no Nginx (não mexe no escala.conf).

Dois tipos de acesso:
  - /sync/*  → o script do PC (9h e 15h). Sem login: chave no cabeçalho
               X-API-Key = FERRAMENTAS_POPS_CHAVE do .env do backend.
  - o resto  → pessoas logadas com a permissão "procedimentos.consultar".
"""
import hmac
import os
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.rate_limit import limiter
from app.db.models import Colaborador
from app.db.session import get_db
from app.ferramentas import pops as P
from app.ferramentas.models import FtPop, FtPopBusca, FtPopSync, FtPopTrecho
from app.ferramentas.seguranca import exigir

CONSULTAR = exigir("procedimentos.consultar")

router = APIRouter(prefix="/pops", tags=["ferramentas · procedimentos"])


# ------------------------------------------------------------ sincronização (PC)

def _chave(x_api_key: str = Header(default="")):
    certa = os.getenv("FERRAMENTAS_POPS_CHAVE", "")
    if not certa or not hmac.compare_digest(x_api_key.encode(), certa.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave de sincronização inválida.")


@router.get("/sync/estado", dependencies=[Depends(_chave)])
def sync_estado(db: Session = Depends(get_db)):
    """O que o servidor já tem: o PC compara tamanho + data e manda só o que mudou."""
    return {p.caminho: {"tamanho": p.tamanho, "modificado": p.modificado} for p in db.query(FtPop).all()}


def _apagar_pop(db: Session, pop: FtPop):
    db.query(FtPopTrecho).filter(FtPopTrecho.pop_id == pop.id).delete()
    P.apagar_imagens(pop.id)
    try:
        (P.pasta_pops() / f"{pop.id}.pdf").unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(pop)


@router.put("/sync/arquivo", dependencies=[Depends(_chave)])
async def sync_arquivo(request: Request, caminho: str = Query(...), modificado: str = Query(""), db: Session = Depends(get_db)):
    caminho = P.caminho_valido(caminho)
    if not caminho:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caminho inválido (só PDF dentro da pasta).")
    dados = await request.body()
    if not dados.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O arquivo não é um PDF.")
    if len(dados) > P.TAM_MAX:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "PDF acima de 11 MB.")

    pop = db.query(FtPop).filter(FtPop.caminho == caminho).first()
    hash_ = P.sha256(dados)
    if pop and pop.sha256 == hash_ and not pop.erro:   # só a data mudou (ex.: OneDrive re-baixou)
        pop.modificado, pop.tamanho = modificado, len(dados)
        db.commit()
        return {"ok": True, "status": "sem_mudanca", "codigo": pop.codigo}
    if pop:
        db.query(FtPopTrecho).filter(FtPopTrecho.pop_id == pop.id).delete()
        P.apagar_imagens(pop.id)
    else:
        pop = FtPop(caminho=caminho, titulo=caminho.rsplit("/", 1)[-1][:-4])
        db.add(pop)
        db.flush()

    (P.pasta_pops() / f"{pop.id}.pdf").write_bytes(dados)
    pop.tamanho, pop.modificado, pop.sha256 = len(dados), modificado, hash_
    pop.sincronizado_em, pop.erro = datetime.utcnow(), None
    try:
        r = P.extrair(dados, caminho, pop.id)
        pop.codigo, pop.versao, pop.titulo, pop.pasta, pop.paginas = r["codigo"], r["versao"], r["titulo"][:300], r["pasta"], r["paginas"]
        for i, t in enumerate(r["trechos"]):
            db.add(FtPopTrecho(pop_id=pop.id, ordem=i, pagina=t["pagina"], secao=(t["secao"] or "")[:300] or None,
                               texto=t["texto"], imagens=t["imagens"] or None))
        qtd = len(r["trechos"])
    except Exception as e:  # PDF protegido/corrompido: fica listado, sem busca no conteúdo
        info = P.identificar(caminho, None, "")
        pop.codigo, pop.versao, pop.titulo, pop.pasta = info["codigo"], info["versao"], info["titulo"], info["pasta"]
        pop.erro, qtd = f"{type(e).__name__}: {e}"[:500], 0
    db.commit()
    return {"ok": True, "status": "erro_leitura" if pop.erro else "atualizado", "codigo": pop.codigo, "trechos": qtd, "erro": pop.erro}


class RemoverIn(BaseModel):
    caminhos: list[str]


@router.post("/sync/remover", dependencies=[Depends(_chave)])
def sync_remover(body: RemoverIn, db: Session = Depends(get_db)):
    """Arquivo que sumiu da pasta (excluído ou movido para "99 - Arquivo antigo")."""
    removidos = 0
    for c in body.caminhos:
        pop = db.query(FtPop).filter(FtPop.caminho == P.caminho_valido(c)).first()
        if pop:
            _apagar_pop(db, pop)
            removidos += 1
    db.commit()
    return {"ok": True, "removidos": removidos}


class FimIn(BaseModel):
    maquina: str | None = None
    total: int = 0
    enviados: int = 0
    removidos: int = 0
    erros: list[str] = []


@router.post("/sync/fim", dependencies=[Depends(_chave)])
def sync_fim(body: FimIn, db: Session = Depends(get_db)):
    db.add(FtPopSync(maquina=(body.maquina or "")[:100], total=body.total, enviados=body.enviados,
                     removidos=body.removidos, erros=body.erros[:50] or None))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ consulta (pessoas)

def _pop_dict(p: FtPop) -> dict:
    return {"id": p.id, "codigo": p.codigo, "titulo": p.titulo, "versao": p.versao, "pasta": p.pasta,
            "caminho": p.caminho, "paginas": p.paginas, "erro": bool(p.erro),
            "link": P.link_sharepoint(p.caminho), "atualizado_em": p.sincronizado_em}


@router.get("")
def listar(db: Session = Depends(get_db), user: Colaborador = Depends(CONSULTAR)):
    pops = db.query(FtPop).order_by(FtPop.pasta, FtPop.codigo, FtPop.titulo).all()
    ult = db.query(FtPopSync).order_by(FtPopSync.em.desc()).first()
    return {
        "pops": [_pop_dict(p) for p in pops],
        "ultima_sync": ult.em if ult else None,
        "ultima_sync_erros": (ult.erros or []) if ult else [],
    }


@router.get("/buscar")
@limiter.limit("60/minute")
def buscar(request: Request, q: str = Query(..., min_length=2, max_length=300), db: Session = Depends(get_db),
           user: Colaborador = Depends(CONSULTAR)):
    chave = db.query(func.count(FtPop.id), func.max(FtPop.sincronizado_em)).one()
    achados, usados = P.indice(db, tuple(chave)).buscar(q)
    trechos = {t.id: t for t in db.query(FtPopTrecho).filter(FtPopTrecho.id.in_([a[0] for a in achados])).all()} if achados else {}
    pops = {p.id: p for p in db.query(FtPop).filter(FtPop.id.in_({t.pop_id for t in trechos.values()})).all()} if trechos else {}
    resultados = []
    for tid, pont in achados:
        t = trechos.get(tid)
        if not t:
            continue
        resultados.append({**_pop_dict(pops[t.pop_id]), "trecho_id": t.id, "secao": t.secao, "pagina": t.pagina,
                           "texto": t.texto, "imagens": t.imagens or [], "pontuacao": pont})
    db.add(FtPopBusca(colaborador_id=user.id, termo=q.strip()[:300], resultados=len(resultados)))
    db.commit()
    return {"q": q, "termos": usados, "resultados": resultados}


@router.get("/trecho/{trecho_id}/vizinhos")
def vizinhos(trecho_id: str, db: Session = Depends(get_db), user: Colaborador = Depends(CONSULTAR)):
    """O trecho anterior e o seguinte do mesmo POP ("ver mais" na tela)."""
    t = db.get(FtPopTrecho, trecho_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trecho não encontrado.")
    viz = (db.query(FtPopTrecho).filter(FtPopTrecho.pop_id == t.pop_id, FtPopTrecho.ordem.in_([t.ordem - 1, t.ordem + 1]))
           .order_by(FtPopTrecho.ordem).all())
    return [{"id": v.id, "secao": v.secao, "pagina": v.pagina, "texto": v.texto, "imagens": v.imagens or [],
             "antes": v.ordem < t.ordem} for v in viz]


@router.get("/arquivo/{nome}")
def arquivo(nome: str, user: Colaborador = Depends(CONSULTAR)):
    """Print (.jpg) ou PDF de um POP. Nome gerado pelo próprio sistema."""
    caminho = P.nome_arquivo_seguro(nome)
    if not caminho or not caminho.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")
    tipo = "application/pdf" if nome.endswith(".pdf") else "image/jpeg"
    return Response(caminho.read_bytes(), media_type=tipo, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/buscas-sem-resultado")
def sem_resultado(db: Session = Depends(get_db), user: Colaborador = Depends(exigir("ft.admin"))):
    """Perguntas que não acharam nada (para saber que POP falta)."""
    linhas = (db.query(FtPopBusca.termo, func.count(FtPopBusca.id), func.max(FtPopBusca.em))
              .filter(FtPopBusca.resultados == 0).group_by(FtPopBusca.termo)
              .order_by(func.count(FtPopBusca.id).desc()).limit(100).all())
    return [{"termo": t, "vezes": n, "ultima": u} for t, n, u in linhas]
