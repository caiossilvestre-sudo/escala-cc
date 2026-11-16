"""Gestão de Custos — tabelas próprias (nada aqui altera as tabelas da escala)."""
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text

from app.db.models import gen_id
from app.db.session import Base


class GcAcesso(Base):
    """Quem pode abrir a Gestão de Custos. Independe do perfil (admin não basta)."""
    __tablename__ = "gc_acessos"
    email = Column(String, primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GcPessoa(Base):
    """Custo mensal de cada colaborador. Os valores só saem pela rota de revelar (com log)."""
    __tablename__ = "gc_pessoas"
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), primary_key=True)
    funcao = Column(String, nullable=False, default="")
    salario = Column(Float, nullable=False, default=0)
    adicionais = Column(Float, nullable=False, default=0)   # função, noturno, DSR...
    beneficios = Column(Float, nullable=False, default=0)   # VR/VA, plano, etc. (mensal)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GcParam(Base):
    __tablename__ = "gc_params"
    chave = Column(String, primary_key=True)
    valor = Column(String, nullable=False)


class GcEquip(Base):
    """Equipamento comprado (só compras novas). Custo mensal = valor ÷ vida útil."""
    __tablename__ = "gc_equipamentos"
    id = Column(String, primary_key=True, default=gen_id)
    tipo = Column(String, nullable=False)              # Fone, Notebook, Monitor...
    modelo = Column(String, nullable=False, default="")
    quantidade = Column(Integer, nullable=False, default=1)
    valor_unit = Column(Float, nullable=False, default=0)
    data_compra = Column(Date, nullable=False)
    setor = Column(String, nullable=True)
    colaborador_id = Column(String, ForeignKey("colaboradores.id"), nullable=True)
    vida_util_meses = Column(Integer, nullable=False, default=24)
    obs = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GcVolume(Base):
    """Volume do mês (digitado, até integrar com o Checkpoint)."""
    __tablename__ = "gc_volume"
    mes = Column(String, primary_key=True)             # "2026-10"
    telefone = Column(Integer, nullable=False, default=0)
    whatsapp = Column(Integer, nullable=False, default=0)
    tma_tel_seg = Column(Integer, nullable=False, default=0)
    tma_wa_seg = Column(Integer, nullable=False, default=0)
    tme_seg = Column(Integer, nullable=False, default=0)


class GcLog(Base):
    __tablename__ = "gc_log"
    id = Column(String, primary_key=True, default=gen_id)
    email = Column(String, nullable=False)
    acao = Column(String, nullable=False)
    alvo = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
