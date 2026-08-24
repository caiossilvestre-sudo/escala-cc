from datetime import date, datetime
from typing import Optional, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

# ---------------------------------------------------------------- auth ----

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    senha_atual: str
    nova_senha: str = Field(min_length=10, max_length=200)

    @field_validator("nova_senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        if v.isdigit() or v.isalpha():
            raise ValueError("A senha deve combinar letras e números.")
        return v


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    colaborador_id: str
    nome: str
    must_change_password: bool


# --------------------------------------------------------- colaborador ----

# "visualizador" enxerga tudo (igual admin), mas nenhuma rota de escrita
# aceita esse papel — só "admin" passa pelo require_admin.
RoleType = Literal["admin", "colaborador", "visualizador"]


class ColaboradorIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: RoleType = "colaborador"
    equipe: str
    turno: str = "Manhã"
    escala_tipo: str = "6x2"
    horario_inicio: str = Field(pattern=r"^\d{2}:\d{2}$")
    horario_fim: str = Field(pattern=r"^\d{2}:\d{2}$")
    senha_inicial: str = Field(min_length=10, max_length=200)


class ColaboradorOut(BaseModel):
    id: str
    nome: str
    email: EmailStr
    role: str
    equipe: str
    turno: str
    escala_tipo: str
    horario_inicio: str
    horario_fim: str
    status: str
    data_desligamento: Optional[date] = None

    model_config = {"from_attributes": True}


class ColaboradorUpdateIn(BaseModel):
    """Para editar dados de um colaborador já existente. Sempre exige um motivo —
    isso vira registro permanente no histórico do colaborador quando muda
    setor ou turno."""
    nome: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role: Optional[RoleType] = None
    equipe: Optional[str] = None
    turno: Optional[str] = None
    escala_tipo: Optional[str] = None
    horario_inicio: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    horario_fim: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    motivo: str = Field(min_length=3, max_length=300)


class DesligarIn(BaseModel):
    motivo: str = Field(min_length=3, max_length=300)


class HistoricoEquipeOut(BaseModel):
    id: str
    colaborador_id: str
    equipe_anterior: Optional[str]
    equipe_nova: Optional[str]
    turno_anterior: Optional[str]
    turno_novo: Optional[str]
    motivo: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# -------------------------------------------------------------- plantão ---

class PlantaoTemplateIn(BaseModel):
    nome: str
    equipe: str
    turno: str = "Manhã"
    horario_inicio: str = Field(pattern=r"^\d{2}:\d{2}$")
    horario_fim: str = Field(pattern=r"^\d{2}:\d{2}$")


class PlantaoTemplateOut(PlantaoTemplateIn):
    id: str
    model_config = {"from_attributes": True}


class PlantaoIn(BaseModel):
    colaborador_id: str
    data: date
    horario_inicio: str = Field(pattern=r"^\d{2}:\d{2}$")
    horario_fim: str = Field(pattern=r"^\d{2}:\d{2}$")
    tipo: Optional[str] = None
    template_id: Optional[str] = None


class PlantaoOut(BaseModel):
    id: str
    colaborador_id: str
    data: date
    horario_inicio: str
    horario_fim: str
    tipo: Optional[str]
    template_id: Optional[str]
    origem: str
    sugerido: bool

    model_config = {"from_attributes": True}


class GerarPlantoesIn(BaseModel):
    mes: str = Field(pattern=r"^\d{4}-\d{2}$")  # "2026-08"


# --------------------------------------------------------- solicitações ---

TipoFolga = Literal["folga_plantao", "folga_sindicato"]


class SolicitacaoIn(BaseModel):
    tipo: TipoFolga
    plantao_id: Optional[str] = None
    data_solicitada: date
    ignorar_aviso: bool = False


class ResolverSolicitacaoIn(BaseModel):
    aprovar: bool
    motivo_rejeicao: Optional[str] = Field(default=None, max_length=500)

    @field_validator("motivo_rejeicao")
    @classmethod
    def exige_motivo_se_rejeitar(cls, v, info):
        return v


class SolicitacaoOut(BaseModel):
    id: str
    colaborador_id: str
    tipo: str
    plantao_id: Optional[str]
    data_solicitada: date
    status: str
    motivo_rejeicao: Optional[str]

    model_config = {"from_attributes": True}


# ------------------------------------------------------------- atestado ---

class AtestadoIn(BaseModel):
    colaborador_id: str
    data_inicio: date
    data_fim: date
    motivo: str = Field(min_length=2, max_length=300)


class AtestadoOut(BaseModel):
    id: str
    colaborador_id: str
    data_inicio: date
    data_fim: date
    motivo: str

    model_config = {"from_attributes": True}


# --------------------------------------------------------------- férias ---

class FeriasIn(BaseModel):
    data_inicio: date
    data_fim: date


class FeriasAvancarIn(BaseModel):
    status: Literal["enviado_rh", "aprovada", "ajustar", "rejeitada"]
    nota_admin: Optional[str] = Field(default=None, max_length=500)


class FeriasOut(BaseModel):
    id: str
    colaborador_id: str
    data_inicio: date
    data_fim: date
    status: str
    nota_admin: Optional[str]

    model_config = {"from_attributes": True}


# -------------------------------------------------------------- feriado ---

class FeriadoIn(BaseModel):
    data: date
    nome: str
    tipo: Literal["obrigatorio", "facultativo"] = "obrigatorio"


class FeriadoOut(BaseModel):
    id: str
    data: date
    nome: str
    tipo: str
    trabalha: bool

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- aviso ---

class AvisoOut(BaseModel):
    id: str
    colaborador_id: str
    tipo: str
    mensagem: str
    data: date
    canais: list[str]
    lido: bool

    model_config = {"from_attributes": True}
