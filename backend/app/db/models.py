import uuid
from datetime import datetime, date

from sqlalchemy import (
    Column, String, Boolean, Date, DateTime, ForeignKey, Integer, JSON, Text
)
from sqlalchemy.orm import relationship

from app.db.session import Base


def gen_id() -> str:
    return str(uuid.uuid4())


class Colaborador(Base):
    """Também é o usuário do sistema (login). role = 'admin' ou 'colaborador'."""
    __tablename__ = "colaboradores"

    id = Column(String, primary_key=True, default=gen_id)
    nome = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="colaborador")  # 'admin' | 'colaborador'

    equipe = Column(String, nullable=False)
    turno = Column(String, nullable=False, default="Manhã")
    escala_tipo = Column(String, nullable=False, default="6x2")
    horario_inicio = Column(String, nullable=False, default="08:00")
    horario_fim = Column(String, nullable=False, default="17:00")
    status = Column(String, nullable=False, default="ativo")  # 'ativo' | 'inativo'
    data_desligamento = Column(Date, nullable=True)
    motivo_desligamento = Column(Text, nullable=True)

    # Segurança de login
    failed_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    must_change_password = Column(Boolean, nullable=False, default=True)

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
    origem = Column(String, nullable=False, default="manual")  # 'manual' | 'auto'
    sugerido = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    colaborador = relationship("Colaborador")


class SolicitacaoFolga(Base):
    __tablename__ = "solicitacoes_folga"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    tipo = Column(String, nullable=False)  # 'folga_plantao' | 'folga_sindicato'
    plantao_id = Column(String, ForeignKey("plantoes.id"), nullable=True)
    data_solicitada = Column(Date, nullable=False)
    status = Column(String, nullable=False, default="pendente")  # pendente|aprovada|rejeitada
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
    # solicitada | enviado_rh | aprovada | ajustar | rejeitada
    nota_admin = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Feriado(Base):
    __tablename__ = "feriados"
    id = Column(String, primary_key=True, default=gen_id)
    data = Column(Date, nullable=False)
    nome = Column(String, nullable=False)
    tipo = Column(String, nullable=False, default="obrigatorio")  # obrigatorio|facultativo
    trabalha = Column(Boolean, nullable=False, default=True)


class Aviso(Base):
    __tablename__ = "avisos"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=False)
    tipo = Column(String, nullable=False)  # mensal | semanal | cobranca
    mensagem = Column(Text, nullable=False)
    data = Column(Date, nullable=False)
    canais = Column(JSON, nullable=False, default=list)
    lido = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class HistoricoEquipe(Base):
    """Registro de cada mudança de equipe/turno de um colaborador. Mantém a
    rastreabilidade de quem estava em qual setor quando — importante para
    relatórios históricos continuarem corretos mesmo depois de uma
    transferência, e para saber quando/por que alguém saiu de um grupo."""
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


class AuditLog(Base):
    """Registro de auditoria: quem fez o quê, quando. Essencial para investigar
    qualquer alteração indevida depois do fato."""
    __tablename__ = "audit_log"
    id = Column(String, primary_key=True, default=gen_id)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    acao = Column(String, nullable=False)  # ex: 'aprovar_folga', 'criar_colaborador'
    entidade = Column(String, nullable=False)  # ex: 'solicitacao_folga'
    entidade_id = Column(String, nullable=True)
    detalhes = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
