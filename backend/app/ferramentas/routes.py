"""Rotas do módulo Ferramentas — todas sob o prefixo /ferramentas.

Lembrete de deploy: o prefixo /ferramentas precisa estar liberado no
Nginx (/etc/nginx/sites-available/escala.conf), igual aos outros prefixos.
"""
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, log_action
from app.core.rate_limit import limiter
from app.db.models import Colaborador
from app.db.session import get_db
from app.ferramentas import fotos, normalizar as nz
from app.ferramentas.models import FtAcesso, FtCamera, FtCredencial, FtGravador
from app.ferramentas.schemas import (
    CameraIn, CameraLoteIn, CameraPatch, CameraResumo, CredencialIn, FotoIn, FotoLoteIn, GravadorIn, GravadorPatch,
    MapearFotosIn, PermissaoIn,
)
from app.ferramentas.seguranca import (
    PERMISSOES, PRESETS, cifrar, decifrar, exigir, normalizar_permissoes, permissoes_do,
)

VER, EDITAR, SENHAS, EXCLUIR, GERENCIAR, ADMIN = (exigir(p) for p in (
    "doc.ver", "doc.editar", "doc.senhas", "doc.excluir", "nvr.gerenciar", "ft.admin"))

# Câmera de NVR desativado (retirado de operação) não aparece na Documentação.
# Os dados continuam no banco; reativando o gravador, tudo volta.
GRAVADOR_EM_USO = or_(FtGravador.id.is_(None), FtGravador.ativo.isnot(False))

router = APIRouter(prefix="/ferramentas", tags=["ferramentas"])


@router.on_event("startup")
def _migrar_colunas_novas():
    from app.ferramentas import migracao
    migracao.aplicar()


# ------------------------------------------------------------------ helpers

def _limpar_camera(dados: dict) -> dict:
    """Padroniza os campos antes de gravar (mesmas regras da importação)."""
    for campo in list(dados.keys()):
        if isinstance(dados[campo], str):
            dados[campo] = nz.texto(dados[campo])
    if "mac" in dados and dados["mac"]:
        valor, ok = nz.mac(dados["mac"])
        if not ok:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "MAC inválido — use 12 dígitos hexadecimais (ex.: 24:FD:0D:7A:FE:C1).")
        dados["mac"] = valor
    for campo in ("ip", "ip_pppoe"):
        if campo in dados and dados[campo]:
            valor, ok = nz.ip(dados[campo])
            if not ok:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{campo.replace('_', ' ').upper()} inválido.")
            dados[campo] = valor
    if "cidade" in dados:
        dados["cidade"] = nz.cidade(dados["cidade"])
    if "compressao" in dados and dados["compressao"]:
        valor, ok = nz.compressao(dados["compressao"])
        dados["compressao"] = valor if ok else dados["compressao"]
    return dados


def _validar_vinculo(db: Session, cam: FtCamera):
    """Nada aqui é obrigatório (a tela avisa o que falta). Só garante que um
    gravador informado existe e limpa os campos do outro tipo."""
    if cam.tipo == "nvr":
        if cam.gravador_id and db.get(FtGravador, cam.gravador_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Gravador não encontrado.")
        cam.lg_id = None
    else:
        cam.gravador_id = None
        cam.canal = None
    if not cam.nome:
        cam.nome = _nome_padrao(cam)


def _nome_padrao(cam: FtCamera) -> str:
    if cam.tipo == "nvr" and cam.canal:
        return f"CANAL {cam.canal}"
    if cam.tipo == "lifeguard" and cam.lg_id:
        return f"LG {cam.lg_id}"
    return "Sem nome"


def _commit_ou_conflito(db: Session):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma câmera nesse gravador/canal ou com esse ID LifeGuard.")


def _nomes(db: Session, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {c.id: c.nome for c in db.query(Colaborador).filter(Colaborador.id.in_(ids)).all()}


def _resumo(cam: FtCamera, grav: FtGravador | None) -> dict:
    return CameraResumo(
        id=cam.id, tipo=cam.tipo, nome=cam.nome, descricao_local=cam.descricao_local,
        gravador_id=cam.gravador_id, gravador_nome=grav.nome if grav else None,
        gravador_origem=grav.origem if grav else None, canal=cam.canal,
        lg_id=cam.lg_id, porta_lifeguard=cam.porta_lifeguard,
        nome_cliente=cam.nome_cliente, contrato_ixc=cam.contrato_ixc, cidade=cam.cidade,
        ip=cam.ip, porta=cam.porta, mac=cam.mac, status=cam.status,
        tem_foto=bool(cam.foto_arquivo), foto_em=cam.foto_em,
    ).model_dump()


def _gravador_dict(g: FtGravador) -> dict:
    return {
        "id": g.id, "nome": g.nome, "origem": g.origem, "url_acesso": g.url_acesso,
        "porta_servico": g.porta_servico, "porta_publica": g.porta_publica,
        "dias_gravacao": g.dias_gravacao, "id_cliente_ixc": g.id_cliente_ixc,
        "nome_cliente": g.nome_cliente, "contrato_ixc": g.contrato_ixc, "cidade": g.cidade,
        "pppoe": g.pppoe, "ip_pppoe": g.ip_pppoe, "observacoes": g.observacoes,
        "ativo": g.ativo is not False, "total_canais": g.total_canais, "marca": g.marca,
        "url_https": g.url_https, "porta_rtsp": g.porta_rtsp,
    }


# --------------------------------------------------------------------- meta

@router.get("/me")
def meu_acesso(user: Colaborador = Depends(get_current_colaborador), db: Session = Depends(get_db)):
    """Usado pelo menu: quais páginas/tópicos a pessoa pode ver."""
    perms = permissoes_do(db, user)
    return {"permissoes": [p for p in PERMISSOES if p in perms], "admin_escala": user.role == "admin"}


@router.get("/resumo")
def resumo(db: Session = Depends(get_db), user=Depends(VER)):
    base = db.query(FtCamera).outerjoin(FtGravador, FtCamera.gravador_id == FtGravador.id).filter(GRAVADOR_EM_USO)
    nvr = base.filter(FtCamera.tipo == "nvr")
    return {
        "cameras_nvr_life": nvr.filter(FtGravador.origem == "life").count(),
        "cameras_nvr_cliente": nvr.filter(FtGravador.origem == "cliente").count(),
        "cameras_lifeguard": base.filter(FtCamera.tipo == "lifeguard").count(),
        "gravadores": db.query(FtGravador).filter(FtGravador.ativo.isnot(False)).count(),
        "gravadores_desativados": db.query(FtGravador).filter(FtGravador.ativo.is_(False)).count(),
        "sem_foto": base.filter(FtCamera.foto_arquivo.is_(None)).count(),
        "total": base.count(),
    }


@router.get("/cidades")
def cidades(db: Session = Depends(get_db), user=Depends(VER)):
    linhas = db.query(FtCamera.cidade).filter(FtCamera.cidade.isnot(None)).distinct().all()
    return sorted(c for (c,) in linhas)


# ---------------------------------------------------------------- gravadores

@router.get("/gravadores")
def listar_gravadores(origem: str | None = None, todos: bool = False, db: Session = Depends(get_db), user=Depends(VER)):
    """Por padrão só os ativos (é o que aparece nos filtros e no cadastro).
    todos=true traz também os desativados (tela Gravadores)."""
    q = db.query(FtGravador)
    if origem in ("life", "cliente"):
        q = q.filter(FtGravador.origem == origem)
    if not todos:
        q = q.filter(FtGravador.ativo.isnot(False))
    contagem = dict(db.query(FtCamera.gravador_id, func.count(FtCamera.id)).group_by(FtCamera.gravador_id).all())
    com_foto = dict(db.query(FtCamera.gravador_id, func.count(FtCamera.id))
                    .filter(FtCamera.foto_arquivo.isnot(None)).group_by(FtCamera.gravador_id).all())
    return [{**_gravador_dict(g), "qtd_cameras": contagem.get(g.id, 0), "qtd_com_foto": com_foto.get(g.id, 0)}
            for g in q.order_by(FtGravador.nome).all()]


@router.get("/gravadores/{gravador_id}")
def detalhe_gravador(gravador_id: str, db: Session = Depends(get_db), user=Depends(VER)):
    g = db.get(FtGravador, gravador_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
    cams = db.query(FtCamera).filter(FtCamera.gravador_id == g.id).order_by(FtCamera.canal).all()
    creds = db.query(FtCredencial).filter(FtCredencial.gravador_id == g.id).order_by(FtCredencial.ordem).all()
    return {**_gravador_dict(g), "canais_usados": [c.canal for c in cams if c.canal],
            "canais": [{"canal": c.canal, "id": c.id, "nome": c.nome, "descricao_local": c.descricao_local,
                        "nome_cliente": c.nome_cliente, "tem_foto": bool(c.foto_arquivo)} for c in cams],
            "credenciais": [{"id": c.id, "usuario": c.usuario, "nome_cliente": c.nome_cliente, "tem_senha": bool(c.senha_cifrada)} for c in creds]}


@router.post("/gravadores", status_code=201)
def criar_gravador(body: GravadorIn, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    dados = body.model_dump()
    dados["nome"] = nz.texto(dados["nome"]).upper()
    dados["cidade"] = nz.cidade(dados.get("cidade"))
    if db.query(FtGravador).filter(FtGravador.nome == dados["nome"]).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um gravador com esse nome.")
    g = FtGravador(**dados)
    db.add(g)
    db.commit()
    log_action(db, request, user, "ft_criar_gravador", "ft_gravador", g.id, {"nome": g.nome})
    return _gravador_dict(g)


@router.patch("/gravadores/{gravador_id}")
def editar_gravador(gravador_id: str, body: GravadorPatch, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    g = db.get(FtGravador, gravador_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
    dados = body.model_dump(exclude_unset=True)
    if dados.get("ativo", True) is None:
        dados.pop("ativo")
    if "nome" in dados and dados["nome"]:
        dados["nome"] = nz.texto(dados["nome"]).upper()
    if dados.get("total_canais"):
        maior = db.query(func.max(FtCamera.canal)).filter(FtCamera.gravador_id == g.id).scalar() or 0
        if dados["total_canais"] < maior:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"O canal {maior} já está documentado — o total de canais não pode ser menor que {maior}.")
    if "cidade" in dados:
        dados["cidade"] = nz.cidade(dados["cidade"])
    for k, v in dados.items():
        setattr(g, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um gravador com esse nome.")
    acao = "ft_editar_gravador"
    if set(dados) == {"ativo"}:
        acao = "ft_reativar_gravador" if dados["ativo"] else "ft_desativar_gravador"
    log_action(db, request, user, acao, "ft_gravador", g.id, {"nome": g.nome, "campos": sorted(dados.keys())})
    return _gravador_dict(g)


@router.delete("/gravadores/{gravador_id}")
def excluir_gravador(gravador_id: str, request: Request, db: Session = Depends(get_db), user=Depends(GERENCIAR)):
    """Só apaga gravador SEM câmeras (ex.: cadastrado por engano). Gravador
    retirado de operação deve ser DESATIVADO — assim nada se perde."""
    g = db.get(FtGravador, gravador_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
    qtd = db.query(FtCamera).filter(FtCamera.gravador_id == g.id).count()
    if qtd:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Este gravador tem {qtd} câmera(s) documentada(s). Para tirar de operação, use Desativar.")
    nome = g.nome
    db.query(FtCredencial).filter(FtCredencial.gravador_id == g.id).delete()
    db.delete(g)
    db.commit()
    log_action(db, request, user, "ft_excluir_gravador", "ft_gravador", gravador_id, {"nome": nome})
    return {"ok": True}


# ------------------------------------------------------------------ câmeras

@router.get("/cameras")
def listar_cameras(
    q: str | None = Query(default=None, max_length=120),
    tipo: str | None = Query(default=None, description="nvr_life | nvr_cliente | lifeguard"),
    status_: str | None = Query(default=None, alias="status"),
    cidade: str | None = None,
    sem_foto: bool = False,
    gravador_id: str | None = None,
    desativados: bool = False,
    pagina: int = Query(default=1, ge=1),
    por_pagina: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(VER),
):
    consulta = db.query(FtCamera, FtGravador).outerjoin(FtGravador, FtCamera.gravador_id == FtGravador.id)
    if tipo == "lifeguard":
        consulta = consulta.filter(FtCamera.tipo == "lifeguard")
    elif tipo in ("nvr_life", "nvr_cliente"):
        consulta = consulta.filter(FtCamera.tipo == "nvr", FtGravador.origem == tipo.split("_")[1])
    if status_ in ("online", "offline", "desconhecido"):
        consulta = consulta.filter(FtCamera.status == status_)
    if cidade:
        consulta = consulta.filter(FtCamera.cidade == cidade)
    if sem_foto:
        consulta = consulta.filter(FtCamera.foto_arquivo.is_(None))
    if gravador_id:
        consulta = consulta.filter(FtCamera.gravador_id == gravador_id)
    elif not desativados:
        consulta = consulta.filter(GRAVADOR_EM_USO)
    if q and q.strip():
        termo = q.strip()
        mac_norm, mac_ok = nz.mac(termo)
        padrao = f"%{termo}%"
        condicoes = [
            FtCamera.nome.ilike(padrao), FtCamera.descricao_local.ilike(padrao),
            FtCamera.nome_cliente.ilike(padrao), FtCamera.contrato_ixc.ilike(padrao),
            FtCamera.id_cliente_ixc.ilike(padrao), FtCamera.ip.ilike(padrao),
            FtCamera.mac.ilike(padrao), FtCamera.lg_id.ilike(padrao), FtCamera.pppoe.ilike(padrao),
            FtCamera.cidade.ilike(padrao), FtGravador.nome.ilike(padrao),
        ]
        if mac_ok and mac_norm and len(termo.replace(":", "").replace("-", "").replace(".", "")) == 12:
            condicoes.append(FtCamera.mac == mac_norm)
        consulta = consulta.filter(or_(*condicoes))

    total = consulta.count()
    linhas = (consulta.order_by(FtGravador.nome.is_(None), FtGravador.nome, FtCamera.canal, FtCamera.nome)
              .offset((pagina - 1) * por_pagina).limit(por_pagina).all())
    return {
        "total": total, "pagina": pagina, "por_pagina": por_pagina,
        "paginas": max(1, -(-total // por_pagina)),
        "itens": [_resumo(c, g) for c, g in linhas],
    }


@router.get("/cameras/{camera_id}")
def detalhe_camera(camera_id: str, db: Session = Depends(get_db), user=Depends(VER)):
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    grav = db.get(FtGravador, cam.gravador_id) if cam.gravador_id else None
    nomes = _nomes(db, {cam.foto_por_id, cam.atualizado_por_id})
    creds = []
    if grav:
        # No NVR Life cada cliente tem o próprio usuário: mostra os gerais
        # do gravador + os do cliente desta câmera.
        filtro_cli = FtCredencial.nome_cliente.is_(None)
        if cam.nome_cliente:
            filtro_cli = or_(filtro_cli, FtCredencial.nome_cliente == cam.nome_cliente)
        creds += [("gravador", c) for c in db.query(FtCredencial).filter(FtCredencial.gravador_id == grav.id, filtro_cli).order_by(FtCredencial.ordem)]
    creds += [("camera", c) for c in db.query(FtCredencial).filter(FtCredencial.camera_id == cam.id).order_by(FtCredencial.ordem)]
    campos = {col.name: getattr(cam, col.name) for col in FtCamera.__table__.columns}
    campos.pop("foto_arquivo", None)
    return {
        **campos,
        "tem_foto": bool(cam.foto_arquivo),
        "foto_por_nome": nomes.get(cam.foto_por_id),
        "atualizado_por_nome": nomes.get(cam.atualizado_por_id),
        "gravador": _gravador_dict(grav) if grav else None,
        # Só o usuário — a senha sai apenas pela rota /revelar (N2+), com auditoria.
        "credenciais": [{"id": c.id, "usuario": c.usuario, "de": de, "nome_cliente": c.nome_cliente, "tem_senha": bool(c.senha_cifrada)} for de, c in creds],
        "pode_editar": "doc.editar" in user.ft_permissoes,
        "pode_ver_senhas": "doc.senhas" in user.ft_permissoes,
        # Canal de NVR nunca é excluído por colaborador: só quem gerencia
        # gravadores pode liberar o canal. Câmera LifeGuard: doc.excluir.
        "pode_excluir": ("nvr.gerenciar" if cam.tipo == "nvr" else "doc.excluir") in user.ft_permissoes,
        "pode_gerenciar_nvr": "nvr.gerenciar" in user.ft_permissoes,
    }


@router.post("/cameras", status_code=201)
def criar_camera(body: CameraIn, request: Request, db: Session = Depends(get_db), user=Depends(EDITAR)):
    dados = _limpar_camera(body.model_dump())
    cam = FtCamera(**dados, atualizado_por_id=user.id)
    _validar_vinculo(db, cam)
    db.add(cam)
    _commit_ou_conflito(db)
    log_action(db, request, user, "ft_criar_camera", "ft_camera", cam.id, {"nome": cam.nome, "tipo": cam.tipo})
    return {"id": cam.id}


@router.post("/cameras/lote", status_code=201)
def criar_cameras_lote(body: CameraLoteIn, request: Request, db: Session = Depends(get_db), user=Depends(EDITAR)):
    """Várias câmeras (normalmente do mesmo cliente) de uma vez. Tudo ou nada:
    se uma linha tiver problema, nenhuma é gravada e a resposta diz qual."""
    novas, vistos_canal, vistos_lg = [], set(), set()
    for i, item in enumerate(body.cameras, start=1):
        try:
            dados = _limpar_camera(item.model_dump())
        except HTTPException as e:
            raise HTTPException(e.status_code, f"Câmera {i}: {e.detail}")
        cam = FtCamera(**dados, atualizado_por_id=user.id)
        try:
            _validar_vinculo(db, cam)
        except HTTPException as e:
            raise HTTPException(e.status_code, f"Câmera {i}: {e.detail}")
        if cam.tipo == "nvr" and cam.gravador_id and cam.canal:
            chave = (cam.gravador_id, cam.canal)
            if chave in vistos_canal or db.query(FtCamera).filter(FtCamera.gravador_id == cam.gravador_id, FtCamera.canal == cam.canal).first():
                raise HTTPException(status.HTTP_409_CONFLICT, f"Câmera {i}: o canal {cam.canal} já está documentado neste gravador.")
            vistos_canal.add(chave)
        if cam.tipo == "lifeguard" and cam.lg_id:
            if cam.lg_id in vistos_lg or db.query(FtCamera).filter(FtCamera.lg_id == cam.lg_id).first():
                raise HTTPException(status.HTTP_409_CONFLICT, f"Câmera {i}: o ID LifeGuard {cam.lg_id} já está documentado.")
            vistos_lg.add(cam.lg_id)
        novas.append(cam)
    db.add_all(novas)
    _commit_ou_conflito(db)
    log_action(db, request, user, "ft_criar_cameras_lote", "ft_camera", None,
               {"qtd": len(novas), "cameras": [{"id": c.id, "nome": c.nome} for c in novas]})
    return {"ids": [c.id for c in novas]}


@router.get("/clientes")
def buscar_clientes(q: str = Query(min_length=2, max_length=80), db: Session = Depends(get_db), user=Depends(VER)):
    """Clientes que já existem na documentação (tirados das câmeras), para
    reaproveitar os dados quando o mesmo cliente contrata mais câmeras."""
    padrao = f"%{q.strip()}%"
    linhas = (db.query(FtCamera.nome_cliente, FtCamera.contrato_ixc, FtCamera.id_cliente_ixc,
                       FtCamera.cidade, FtCamera.pppoe, FtCamera.ip_pppoe, FtCamera.gravador_id)
              .filter(or_(FtCamera.nome_cliente.ilike(padrao), FtCamera.contrato_ixc.ilike(padrao),
                          FtCamera.id_cliente_ixc.ilike(padrao), FtCamera.pppoe.ilike(padrao)))
              .limit(3000).all())
    grupos = {}
    for nome, contrato, id_cli, cidade, pppoe, ip_pppoe, grav_id in linhas:
        if not nome and not contrato:
            continue
        chave = ((nome or "").strip().lower(), contrato or "")
        g = grupos.setdefault(chave, {"nome_cliente": nome, "contrato_ixc": contrato, "id_cliente_ixc": None,
                                      "cidade": None, "pppoe": None, "ip_pppoe": None, "qtd_cameras": 0, "gravadores": set()})
        g["qtd_cameras"] += 1
        for campo, valor in (("id_cliente_ixc", id_cli), ("cidade", cidade), ("pppoe", pppoe), ("ip_pppoe", ip_pppoe)):
            if valor and not g[campo]:
                g[campo] = valor
        if grav_id:
            g["gravadores"].add(grav_id)
    saida = sorted(grupos.values(), key=lambda g: -g["qtd_cameras"])[:15]
    nomes_grav = {g.id: g.nome for g in db.query(FtGravador).filter(
        FtGravador.id.in_({gid for c in saida for gid in c["gravadores"]})).all()} if saida else {}
    for c in saida:
        c["gravadores"] = sorted(nomes_grav.get(gid, "") for gid in c["gravadores"])
    return saida


@router.patch("/cameras/{camera_id}")
def editar_camera(camera_id: str, body: CameraPatch, request: Request, db: Session = Depends(get_db), user=Depends(EDITAR)):
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    dados = _limpar_camera(body.model_dump(exclude_unset=True))
    for k, v in dados.items():
        setattr(cam, k, v)
    cam.atualizado_por_id = user.id
    _validar_vinculo(db, cam)
    _commit_ou_conflito(db)
    log_action(db, request, user, "ft_editar_camera", "ft_camera", cam.id, {"campos": sorted(dados.keys())})
    return {"ok": True}


@router.delete("/cameras/{camera_id}")
def excluir_camera(camera_id: str, request: Request, db: Session = Depends(get_db), user=Depends(VER)):
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    precisa = "nvr.gerenciar" if cam.tipo == "nvr" else "doc.excluir"
    if precisa not in user.ft_permissoes:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Canal de gravador não pode ser excluído — edite ou substitua a câmera. Só o administrador libera canais."
                            if cam.tipo == "nvr" else f"Sem permissão para: {PERMISSOES[precisa]}.")
    nome, arquivo = cam.nome, cam.foto_arquivo
    db.query(FtCredencial).filter(FtCredencial.camera_id == cam.id).delete()
    db.delete(cam)
    db.commit()
    fotos.apagar(arquivo)
    log_action(db, request, user, "ft_excluir_camera", "ft_camera", camera_id, {"nome": nome})
    return {"ok": True}


# -------------------------------------------------------------------- foto

@router.get("/cameras/{camera_id}/foto")
def ver_foto(camera_id: str, db: Session = Depends(get_db), user=Depends(VER)):
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    dado = fotos.ler_base64(cam.foto_arquivo) if cam.foto_arquivo else None
    if not dado:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esta câmera ainda não tem foto de documentação.")
    return {"imagem_base64": dado, "mime": "image/jpeg", "foto_em": cam.foto_em,
            "foto_por_nome": _nomes(db, {cam.foto_por_id}).get(cam.foto_por_id), "bytes": cam.foto_bytes}


@router.post("/cameras/{camera_id}/foto")
@limiter.limit("30/minute")
def salvar_foto(camera_id: str, body: FotoIn, request: Request, db: Session = Depends(get_db), user=Depends(EDITAR)):
    """Importa (grava/substitui) a foto da documentação de uma câmera.
    Só existe UMA por câmera. O sistema não captura nada — a imagem vem de
    um arquivo escolhido pela pessoa."""
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    jpeg, largura, altura = fotos.normalizar_imagem(fotos.decodificar_base64(body.imagem_base64))
    substituiu = _gravar_foto(cam, jpeg, user)
    db.commit()
    log_action(db, request, user, "ft_foto_camera", "ft_camera", cam.id,
               {"substituiu": substituiu, "largura": largura, "altura": altura, "bytes": len(jpeg)})
    return {"ok": True, "foto_em": cam.foto_em, "bytes": len(jpeg), "largura": largura, "altura": altura}


def _gravar_foto(cam: FtCamera, jpeg: bytes, user) -> bool:
    anterior = cam.foto_arquivo
    substituiu = bool(anterior)
    cam.foto_arquivo = fotos.salvar(cam.id, jpeg)
    if anterior and anterior != cam.foto_arquivo:
        fotos.apagar(anterior)  # ex.: foto antiga no disco, nova no SharePoint
    cam.foto_em = datetime.utcnow()
    cam.foto_por_id = user.id
    cam.foto_bytes = len(jpeg)
    return substituiu


# ------------------------------------------------- exportar / importar em lote

_RE_CANAL = re.compile(r"(?:canal|ch|cam|channel)[\s_-]*0*(\d{1,3})\b", re.IGNORECASE)
_RE_SO_NUMERO = re.compile(r"^0*(\d{1,3})$")
_RE_LG = re.compile(r"^lg[\s_-]*(\d+)$", re.IGNORECASE)
_RE_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


@router.get("/cameras-exportar")
def exportar_cameras(
    tipo: str | None = None, cidade: str | None = None, gravador_id: str | None = None,
    db: Session = Depends(get_db), user=Depends(VER),
):
    """Lista completa (sem senhas) para virar CSV no navegador — base para o
    script externo de captura saber quais câmeras existem e como nomear os arquivos."""
    q = db.query(FtCamera, FtGravador).outerjoin(FtGravador, FtCamera.gravador_id == FtGravador.id)
    if tipo == "lifeguard":
        q = q.filter(FtCamera.tipo == "lifeguard")
    elif tipo in ("nvr_life", "nvr_cliente"):
        q = q.filter(FtCamera.tipo == "nvr", FtGravador.origem == tipo.split("_")[1])
    if cidade:
        q = q.filter(FtCamera.cidade == cidade)
    if gravador_id:
        q = q.filter(FtCamera.gravador_id == gravador_id)
    else:
        q = q.filter(GRAVADOR_EM_USO)
    linhas = q.order_by(FtGravador.nome.is_(None), FtGravador.nome, FtCamera.canal, FtCamera.nome).all()
    return [{
        "id": c.id, "tipo": "lifeguard" if c.tipo == "lifeguard" else f"nvr_{g.origem}" if g else "nvr",
        "gravador": g.nome if g else None, "gravador_url": g.url_acesso if g else None, "canal": c.canal,
        "lg_id": c.lg_id, "nome": c.nome, "descricao_local": c.descricao_local,
        "cliente": c.nome_cliente, "contrato_ixc": c.contrato_ixc, "cidade": c.cidade,
        "ip_pppoe": c.ip_pppoe, "porta_publica": c.porta_publica, "porta_lifeguard": c.porta_lifeguard,
        "ip": c.ip, "porta": c.porta, "mac": c.mac, "modelo": c.modelo,
        "tem_foto": bool(c.foto_arquivo),
        "arquivo_sugerido": (f"LG{c.lg_id}.jpg" if c.tipo == "lifeguard" and c.lg_id else f"{c.id}.jpg"),
    } for c, g in linhas]


@router.post("/fotos/mapear")
def mapear_fotos(body: MapearFotosIn, db: Session = Depends(get_db), user=Depends(EDITAR)):
    """Descobre a câmera de cada arquivo pelo nome, antes de enviar as imagens."""
    por_canal = {}
    if body.gravador_id:
        if not db.get(FtGravador, body.gravador_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
        por_canal = {c.canal: c for c in db.query(FtCamera).filter(FtCamera.gravador_id == body.gravador_id)}
    saida = []
    for nome in body.nomes:
        base = nome.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        radical = base.rsplit(".", 1)[0].strip()
        cam, motivo = None, None
        if body.gravador_id:
            m = _RE_CANAL.search(radical) or _RE_SO_NUMERO.match(radical)
            if not m:
                motivo = "Nome sem número de canal (use CANAL 01.jpg)"
            else:
                cam = por_canal.get(int(m.group(1)))
                motivo = None if cam else f"Canal {int(m.group(1))} não documentado neste gravador"
        elif _RE_UUID.match(radical):
            cam = db.get(FtCamera, radical.lower())
            motivo = None if cam else "Id não encontrado"
        elif _RE_LG.match(radical):
            lg = _RE_LG.match(radical).group(1)
            cam = db.query(FtCamera).filter(FtCamera.lg_id == lg).first()
            motivo = None if cam else f"ID LifeGuard {lg} não documentado"
        else:
            motivo = "Nome não reconhecido (use o id do CSV ou LG<ID>.jpg)"
        saida.append({
            "nome": base, "camera_id": cam.id if cam else None, "camera_nome": cam.nome if cam else None,
            "canal": cam.canal if cam else None, "tem_foto": bool(cam.foto_arquivo) if cam else False, "motivo": motivo,
        })
    return saida


@router.post("/fotos/lote")
@limiter.limit("120/minute")
def importar_fotos_lote(body: FotoLoteIn, request: Request, db: Session = Depends(get_db), user=Depends(EDITAR)):
    """Recebe até 10 imagens por chamada (o navegador manda em sequência)."""
    resultado = []
    gravadas = []
    for item in body.itens:
        cam = db.get(FtCamera, item.camera_id)
        if not cam:
            resultado.append({"camera_id": item.camera_id, "status": "erro", "motivo": "Câmera não encontrada"})
            continue
        if cam.foto_arquivo and not body.substituir:
            resultado.append({"camera_id": cam.id, "status": "mantida", "motivo": "Já tinha foto"})
            continue
        try:
            jpeg, _, _ = fotos.normalizar_imagem(fotos.decodificar_base64(item.imagem_base64))
        except HTTPException as e:
            resultado.append({"camera_id": cam.id, "status": "erro", "motivo": e.detail})
            continue
        substituiu = _gravar_foto(cam, jpeg, user)
        gravadas.append({"camera_id": cam.id, "arquivo": item.arquivo, "substituiu": substituiu})
        resultado.append({"camera_id": cam.id, "status": "substituida" if substituiu else "importada"})
    db.commit()
    if gravadas:
        log_action(db, request, user, "ft_foto_lote", "ft_camera", None, {"fotos": gravadas})
    return resultado


# -------------------------------------------------------------- credenciais

@router.post("/credenciais", status_code=201)
def criar_credencial(body: CredencialIn, request: Request, db: Session = Depends(get_db), user=Depends(SENHAS)):
    if bool(body.gravador_id) == bool(body.camera_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o gravador OU a câmera.")
    if body.gravador_id and not db.get(FtGravador, body.gravador_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
    if body.camera_id and not db.get(FtCamera, body.camera_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    filtro = FtCredencial.gravador_id == body.gravador_id if body.gravador_id else FtCredencial.camera_id == body.camera_id
    ordem = (db.query(func.max(FtCredencial.ordem)).filter(filtro).scalar() or 0) + 1
    c = FtCredencial(gravador_id=body.gravador_id, camera_id=body.camera_id,
                     usuario=body.usuario.strip(), nome_cliente=nz.texto(body.nome_cliente),
                     senha_cifrada=cifrar(body.senha), ordem=ordem)
    db.add(c)
    db.commit()
    log_action(db, request, user, "ft_criar_credencial", "ft_credencial", c.id,
               {"usuario": c.usuario, "gravador_id": c.gravador_id, "camera_id": c.camera_id})
    return {"id": c.id}


@router.delete("/credenciais/{cred_id}")
def excluir_credencial(cred_id: str, request: Request, db: Session = Depends(get_db), user=Depends(SENHAS)):
    c = db.get(FtCredencial, cred_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credencial não encontrada.")
    usuario = c.usuario
    db.delete(c)
    db.commit()
    log_action(db, request, user, "ft_excluir_credencial", "ft_credencial", cred_id, {"usuario": usuario})
    return {"ok": True}


@router.post("/credenciais/{cred_id}/revelar")
@limiter.limit("30/minute")
def revelar_senha(cred_id: str, request: Request, db: Session = Depends(get_db), user=Depends(SENHAS)):
    c = db.get(FtCredencial, cred_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credencial não encontrada.")
    senha = decifrar(c.senha_cifrada)
    log_action(db, request, user, "ft_revelar_senha", "ft_credencial", c.id,
               {"usuario": c.usuario, "gravador_id": c.gravador_id, "camera_id": c.camera_id})
    return {"senha": senha}


# --------------------------------------------------------------- permissões

@router.get("/permissoes")
def listar_permissoes(db: Session = Depends(get_db), user=Depends(ADMIN)):
    acessos = {a.colaborador_id: normalizar_permissoes(a.permissoes) for a in db.query(FtAcesso).all()}
    pessoas = db.query(Colaborador).filter(Colaborador.status == "ativo").order_by(Colaborador.nome).all()
    return {
        "catalogo": [{"codigo": k, "label": v} for k, v in PERMISSOES.items()],
        "presets": PRESETS,
        "pessoas": [{
            "colaborador_id": p.id, "nome": p.nome, "equipe": p.equipe, "role": p.role,
            "permissoes": list(PERMISSOES) if p.role == "admin" else acessos.get(p.id, []),
            "fixo": p.role == "admin",  # admin do Escala sempre tem tudo
        } for p in pessoas],
    }


@router.post("/permissoes")
def definir_permissao(body: PermissaoIn, request: Request, db: Session = Depends(get_db), user=Depends(ADMIN)):
    alvo = db.get(Colaborador, body.colaborador_id)
    if not alvo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado.")
    if alvo.role == "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Administradores do Escala já têm acesso total a Ferramentas.")
    novas = normalizar_permissoes(body.permissoes)
    atual = db.get(FtAcesso, alvo.id)
    antes = normalizar_permissoes(atual.permissoes) if atual else []
    if not novas:
        if atual:
            db.delete(atual)
    elif atual:
        atual.permissoes = novas
        atual.atualizado_por_id = user.id
    else:
        db.add(FtAcesso(colaborador_id=alvo.id, permissoes=novas, atualizado_por_id=user.id))
    db.commit()
    log_action(db, request, user, "ft_permissoes", "colaborador", alvo.id, {"antes": antes, "depois": novas})
    return {"ok": True, "permissoes": novas}
