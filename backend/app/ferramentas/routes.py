"""Rotas do módulo Ferramentas — todas sob o prefixo /ferramentas.

Lembrete de deploy: o prefixo /ferramentas precisa estar liberado no
Nginx (/etc/nginx/sites-available/escala.conf), igual aos outros prefixos.
"""
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
    CameraIn, CameraPatch, CameraResumo, CredencialIn, FotoIn, GravadorIn, GravadorPatch, PermissaoIn,
)
from app.ferramentas.seguranca import (
    PERMISSOES, PRESETS, cifrar, decifrar, exigir, normalizar_permissoes, permissoes_do,
)

VER, EDITAR, SENHAS, EXCLUIR, ADMIN = (exigir(p) for p in ("doc.ver", "doc.editar", "doc.senhas", "doc.excluir", "ft.admin"))

router = APIRouter(prefix="/ferramentas", tags=["ferramentas"])


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
    if cam.tipo == "nvr":
        if not cam.gravador_id or not cam.canal:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Câmera de NVR precisa de gravador e canal.")
        if db.get(FtGravador, cam.gravador_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Gravador não encontrado.")
        cam.lg_id = None
    else:
        if not cam.lg_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Câmera LifeGuard precisa do ID da câmera.")
        cam.gravador_id = None
        cam.canal = None


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
    }


# --------------------------------------------------------------------- meta

@router.get("/me")
def meu_acesso(user: Colaborador = Depends(get_current_colaborador), db: Session = Depends(get_db)):
    """Usado pelo menu: quais páginas/tópicos a pessoa pode ver."""
    perms = permissoes_do(db, user)
    return {"permissoes": [p for p in PERMISSOES if p in perms], "admin_escala": user.role == "admin"}


@router.get("/resumo")
def resumo(db: Session = Depends(get_db), user=Depends(VER)):
    base = db.query(FtCamera)
    nvr = base.filter(FtCamera.tipo == "nvr")
    return {
        "cameras_nvr_life": nvr.join(FtGravador).filter(FtGravador.origem == "life").count(),
        "cameras_nvr_cliente": nvr.join(FtGravador).filter(FtGravador.origem == "cliente").count(),
        "cameras_lifeguard": base.filter(FtCamera.tipo == "lifeguard").count(),
        "gravadores": db.query(FtGravador).count(),
        "sem_foto": base.filter(FtCamera.foto_arquivo.is_(None)).count(),
        "total": base.count(),
    }


@router.get("/cidades")
def cidades(db: Session = Depends(get_db), user=Depends(VER)):
    linhas = db.query(FtCamera.cidade).filter(FtCamera.cidade.isnot(None)).distinct().all()
    return sorted(c for (c,) in linhas)


# ---------------------------------------------------------------- gravadores

@router.get("/gravadores")
def listar_gravadores(origem: str | None = None, db: Session = Depends(get_db), user=Depends(VER)):
    q = db.query(FtGravador)
    if origem in ("life", "cliente"):
        q = q.filter(FtGravador.origem == origem)
    contagem = dict(db.query(FtCamera.gravador_id, func.count(FtCamera.id)).group_by(FtCamera.gravador_id).all())
    return [{**_gravador_dict(g), "qtd_cameras": contagem.get(g.id, 0)} for g in q.order_by(FtGravador.nome).all()]


@router.get("/gravadores/{gravador_id}")
def detalhe_gravador(gravador_id: str, db: Session = Depends(get_db), user=Depends(VER)):
    g = db.get(FtGravador, gravador_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
    usados = [c for (c,) in db.query(FtCamera.canal).filter(FtCamera.gravador_id == g.id).order_by(FtCamera.canal).all()]
    creds = db.query(FtCredencial).filter(FtCredencial.gravador_id == g.id).order_by(FtCredencial.ordem).all()
    return {**_gravador_dict(g), "canais_usados": usados,
            "credenciais": [{"id": c.id, "usuario": c.usuario, "nome_cliente": c.nome_cliente, "tem_senha": bool(c.senha_cifrada)} for c in creds]}


@router.post("/gravadores", status_code=201)
def criar_gravador(body: GravadorIn, request: Request, db: Session = Depends(get_db), user=Depends(SENHAS)):
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
def editar_gravador(gravador_id: str, body: GravadorPatch, request: Request, db: Session = Depends(get_db), user=Depends(SENHAS)):
    g = db.get(FtGravador, gravador_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gravador não encontrado.")
    dados = body.model_dump(exclude_unset=True)
    if "nome" in dados and dados["nome"]:
        dados["nome"] = nz.texto(dados["nome"]).upper()
    if "cidade" in dados:
        dados["cidade"] = nz.cidade(dados["cidade"])
    for k, v in dados.items():
        setattr(g, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um gravador com esse nome.")
    log_action(db, request, user, "ft_editar_gravador", "ft_gravador", g.id, {"campos": sorted(dados.keys())})
    return _gravador_dict(g)


# ------------------------------------------------------------------ câmeras

@router.get("/cameras")
def listar_cameras(
    q: str | None = Query(default=None, max_length=120),
    tipo: str | None = Query(default=None, description="nvr_life | nvr_cliente | lifeguard"),
    status_: str | None = Query(default=None, alias="status"),
    cidade: str | None = None,
    sem_foto: bool = False,
    gravador_id: str | None = None,
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
        "pode_excluir": "doc.excluir" in user.ft_permissoes,
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


@router.patch("/cameras/{camera_id}")
def editar_camera(camera_id: str, body: CameraPatch, request: Request, db: Session = Depends(get_db), user=Depends(EDITAR)):
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    dados = _limpar_camera(body.model_dump(exclude_unset=True))
    if "nome" in dados and not dados["nome"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nome da câmera é obrigatório.")
    for k, v in dados.items():
        setattr(cam, k, v)
    cam.atualizado_por_id = user.id
    _validar_vinculo(db, cam)
    _commit_ou_conflito(db)
    log_action(db, request, user, "ft_editar_camera", "ft_camera", cam.id, {"campos": sorted(dados.keys())})
    return {"ok": True}


@router.delete("/cameras/{camera_id}")
def excluir_camera(camera_id: str, request: Request, db: Session = Depends(get_db), user=Depends(EXCLUIR)):
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
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
    """Grava/substitui a foto da documentação. Só existe UMA por câmera.
    Capturas só para exportar não passam por aqui — ficam no navegador/LifeGuard."""
    cam = db.get(FtCamera, camera_id)
    if not cam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Câmera não encontrada.")
    jpeg, largura, altura = fotos.normalizar_imagem(fotos.decodificar_base64(body.imagem_base64))
    substituiu = bool(cam.foto_arquivo)
    cam.foto_arquivo = fotos.salvar(cam.id, jpeg)
    cam.foto_em = datetime.utcnow()
    cam.foto_por_id = user.id
    cam.foto_bytes = len(jpeg)
    db.commit()
    log_action(db, request, user, "ft_foto_camera", "ft_camera", cam.id,
               {"substituiu": substituiu, "largura": largura, "altura": altura, "bytes": len(jpeg)})
    return {"ok": True, "foto_em": cam.foto_em, "bytes": len(jpeg), "largura": largura, "altura": altura}


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
