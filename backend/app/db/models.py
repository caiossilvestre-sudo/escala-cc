import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Boolean, Date, DateTime, ForeignKey, Integer, JSON, Text
)
from sqlalchemy.orm import relationship

from app.db.session import Base


def gen_id() -> str:
    return str(uuid.uuid4())


class Colaborador(Base):
    __tablename__ = "colaboradores"

    id = Column(String, primary_key=True, default=gen_id)
    nome = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="colaborador")

    equipe = Column(String, nullable=False)
    turno = Column(String, nullable=False, default="Manhã")
    escala_tipo = Column(String, nullable=False, default="6x2")
    horario_inicio = Column(String, nullable=False, default="08:00")
    horario_fim = Column(String, nullable=False, default="17:00")
    status = Column(String, nullable=False, default="ativo")
    data_desligamento = Column(Date, nullable=True)
    motivo_desligamento = Column(Text, nullable=True)

    failed_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    must_change_password = Column(Boolean, nullable=False, default=True)

    # Campos novos, todos opcionais — a base já tinha gente cadastrada sem
    # essa informação, então nada aqui pode ser obrigatório.
    equipes_gerenciadas = Column(JSON, nullable=True)  # lista de setores, só usado quando role="supervisor"
    data_admissao = Column(Date, nullable=True)
    data_aniversario = Column(Date, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    token_hash = Column(String, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class PlantaoTemplate(Base):
    __tablename__ = "plantao_templates"
    id = Column(String, primary_key=True, default=gen_id)
    nome = Column(String, nullable=False)
    equipe = Column(String, nullable=False)
    turno = Column(String, nullable=False, default="Manhã")
    horario_inicio = Column(String, nullable=False)
    horario_fim = Column(String, nullable=False)


class Plantao(Base):
    __tablename__ = "plantoes"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    data = Column(Date, nullable=False)
    horario_inicio = Column(String, nullable=False)
    horario_fim = Column(String, nullable=False)
    tipo = Column(String, nullable=True)
    template_id = Column(String, ForeignKey("plantao_templates.id"), nullable=True)
    origem = Column(String, nullable=False, default="manual")
    sugerido = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    colaborador = relationship("Colaborador")


class SolicitacaoFolga(Base):
    __tablename__ = "solicitacoes_folga"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    tipo = Column(String, nullable=False)
    plantao_id = Column(String, ForeignKey("plantoes.id"), nullable=True)
    data_solicitada = Column(Date, nullable=False)
    status = Column(String, nullable=False, default="pendente")
    motivo_rejeicao = Column(Text, nullable=True)
    resolved_by = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Atestado(Base):
    __tablename__ = "atestados"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    data_inicio = Column(Date, nullable=False)
    data_fim = Column(Date, nullable=False)
    motivo = Column(String, nullable=False)
    created_by = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Ferias(Base):
    __tablename__ = "ferias"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    data_inicio = Column(Date, nullable=False)
    data_fim = Column(Date, nullable=False)
    status = Column(String, nullable=False, default="solicitada")
    nota_admin = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Feriado(Base):
    __tablename__ = "feriados"
    id = Column(String, primary_key=True, default=gen_id)
    data = Column(Date, nullable=False)
    nome = Column(String, nullable=False)
    tipo = Column(String, nullable=False, default="obrigatorio")
    trabalha = Column(Boolean, nullable=False, default=True)


class Aviso(Base):
    __tablename__ = "avisos"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    tipo = Column(String, nullable=False)
    mensagem = Column(Text, nullable=False)
    data = Column(Date, nullable=False)
    canais = Column(JSON, nullable=False, default=list)
    lido = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class HistoricoEquipe(Base):
    __tablename__ = "historico_equipe"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    equipe_anterior = Column(String, nullable=True)
    equipe_nova = Column(String, nullable=True)
    turno_anterior = Column(String, nullable=True)
    turno_novo = Column(String, nullable=True)
    motivo = Column(Text, nullable=True)
    alterado_por = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Configuracao(Base):
    """Tabela pequena de configurações editáveis pelo admin — hoje só a
    mensagem de aniversário, mas serve pra qualquer texto ajustável no futuro."""
    __tablename__ = "configuracoes"
    chave = Column(String, primary_key=True)
    valor = Column(Text, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    acao = Column(String, nullable=False)
    entidade = Column(String, nullable=False)
    entidade_id = Column(String, nullable=True)
    detalhes = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
