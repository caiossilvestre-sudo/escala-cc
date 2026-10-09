"""Tabelas do módulo Ferramentas (LifeGuard · Documentação).

Tudo com prefixo "ft_" para ficar separado das tabelas da escala. O
Base.metadata.create_all() que o Escala já roda no startup cria estas
tabelas sozinho na primeira vez — nada nas tabelas existentes é alterado.

Cliente e contrato ficam como campos na câmera/gravador (o IXC continua
sendo a fonte oficial de clientes; aqui é só a referência para busca).
"""
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)

from app.db.models import gen_id
from app.db.session import Base


class FtAcesso(Base):
    """Permissões de cada colaborador em Ferramentas, por página/tópico.

    `permissoes` é uma lista de códigos (ver seguranca.PERMISSOES), ex.:
    ["doc.ver", "doc.editar", "referencia", "diagnostico"].
    Independe do perfil na escala. Admin do Escala sempre tem tudo.
    (Substitui a antiga tabela ft_permissoes, por nível — que pode ser
    apagada do banco, não é mais usada.)
    """
    __tablename__ = "ft_acessos"
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), primary_key=True)
    permissoes = Column(JSON, nullable=False, default=list)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    atualizado_por_id = Column(String, ForeignKey("colaboradores.id"), nullable=True)


class FtGravador(Base):
    __tablename__ = "ft_gravadores"
    id = Column(String, primary_key=True, default=gen_id)
    nome = Column(String, nullable=False, unique=True, index=True)  # ex: "PREF DE MARÍLIA - NVR12"
    # Onde o gravador está fisicamente:
    #   life    -> NVR Life: instalado na Life; as câmeras do cliente chegam
    #              pelo PPPoE dele até o NVR (usa porta pública por câmera)
    #   cliente -> NVR externo: instalado no cliente; acesso pelo PPPoE/IP
    #              do próprio cliente
    origem = Column(String, nullable=False, default="life", index=True)
    url_acesso = Column(String, nullable=True)
    porta_servico = Column(String, nullable=True)
    porta_publica = Column(String, nullable=True)
    dias_gravacao = Column(Integer, nullable=True)
    id_cliente_ixc = Column(String, nullable=True, index=True)
    nome_cliente = Column(String, nullable=True)
    contrato_ixc = Column(String, nullable=True, index=True)
    cidade = Column(String, nullable=True)
    pppoe = Column(String, nullable=True)
    ip_pppoe = Column(String, nullable=True)
    observacoes = Column(Text, nullable=True)
    # Gerenciamento (colunas novas — entram sozinhas pelo migracao.py)
    ativo = Column(Boolean, nullable=False, default=True, server_default="true")  # False = retirado de operação
    total_canais = Column(Integer, nullable=True)   # capacidade do NVR (16, 32, 64, 128...)
    marca = Column(String, nullable=True)           # intelbras | hikvision | outra
    url_https = Column(String, nullable=True)       # url_acesso continua sendo o acesso HTTP
    porta_rtsp = Column(String, nullable=True)      # porta pública que leva à 554 do NVR
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FtCamera(Base):
    __tablename__ = "ft_cameras"
    __table_args__ = (UniqueConstraint("gravador_id", "canal", name="uq_ft_camera_gravador_canal"),)

    id = Column(String, primary_key=True, default=gen_id)
    tipo = Column(String, nullable=False)  # nvr | lifeguard

    # NVR
    gravador_id = Column(String, ForeignKey("ft_gravadores.id"), nullable=True, index=True)
    canal = Column(Integer, nullable=True)
    numero_cam = Column(String, nullable=True)

    # LifeGuard
    lg_id = Column(String, nullable=True, unique=True, index=True)
    porta_lifeguard = Column(String, nullable=True)
    porta_monitoramento = Column(String, nullable=True)
    link_provisionamento = Column(String, nullable=True)

    nome = Column(String, nullable=False)
    descricao_local = Column(String, nullable=True)

    id_cliente_ixc = Column(String, nullable=True, index=True)
    nome_cliente = Column(String, nullable=True, index=True)
    contrato_ixc = Column(String, nullable=True, index=True)
    cidade = Column(String, nullable=True, index=True)
    pppoe = Column(String, nullable=True)
    ip_pppoe = Column(String, nullable=True)
    porta_publica = Column(String, nullable=True)

    ip = Column(String, nullable=True, index=True)
    porta = Column(String, nullable=True)
    mac = Column(String, nullable=True, index=True)  # sempre AA:BB:CC:DD:EE:FF
    modelo = Column(String, nullable=True)
    compressao = Column(String, nullable=True)
    firmware = Column(String, nullable=True)
    dias_gravacao = Column(Integer, nullable=True)
    # Situação da câmera: online | offline | desconhecido. Vem do diagnóstico
    # do LifeGuard (ou de quem editar). Obs.: o "STATUS CANAL" da planilha
    # significava canal ocupado/livre, não câmera funcionando — por isso a
    # importação entra tudo como "desconhecido". Canal livre é calculado.
    status = Column(String, nullable=False, default="desconhecido")
    observacoes = Column(Text, nullable=True)

    # Foto da documentação — UMA por câmera. Atualizar substitui o arquivo.
    foto_arquivo = Column(String, nullable=True)
    foto_em = Column(DateTime, nullable=True)
    foto_por_id = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    foto_bytes = Column(Integer, nullable=True)

    origem_importacao = Column(String, nullable=True)  # aba da planilha de onde veio
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    atualizado_por_id = Column(String, ForeignKey("colaboradores.id"), nullable=True)


class FtCredencial(Base):
    """Usuário/senha de acesso a um gravador (ou a uma câmera LifeGuard).
    A senha é guardada CIFRADA (Fernet) — dá para ler de volta só com a
    chave do .env, e cada leitura entra no audit_log."""
    __tablename__ = "ft_credenciais"
    id = Column(String, primary_key=True, default=gen_id)
    gravador_id = Column(String, ForeignKey("ft_gravadores.id"), nullable=True, index=True)
    camera_id = Column(String, ForeignKey("ft_cameras.id"), nullable=True, index=True)
    usuario = Column(String, nullable=False)
    # Em NVR Life (compartilhado por vários clientes) cada cliente tem o
    # próprio usuário: aqui fica de qual cliente é. Vazio = usuário geral
    # do gravador (ex.: monitoramento), mostrado em todas as câmeras dele.
    nome_cliente = Column(String, nullable=True)
    senha_cifrada = Column(Text, nullable=True)
    ordem = Column(Integer, nullable=False, default=0)
    criado_em = Column(DateTime, default=datetime.utcnow)
