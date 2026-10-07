from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Tipo = Literal["nvr", "lifeguard"]
Status = Literal["online", "offline", "desconhecido"]
Origem = Literal["life", "cliente"]

S = lambda n=200: Field(default=None, max_length=n)  # noqa: E731


class CameraIn(BaseModel):
    """Nenhum dado é obrigatório além do tipo: a tela avisa o que está faltando
    e a pessoa decide salvar mesmo assim. Sem nome, o sistema usa
    "CANAL n" / "LG id" / "Sem nome"."""
    tipo: Tipo = "nvr"
    nome: str | None = S(200)
    descricao_local: str | None = S(300)
    gravador_id: str | None = S(60)
    canal: int | None = Field(default=None, ge=1, le=512)
    numero_cam: str | None = S(20)
    lg_id: str | None = S(40)
    porta_lifeguard: str | None = S(20)
    porta_monitoramento: str | None = S(20)
    link_provisionamento: str | None = S(500)
    id_cliente_ixc: str | None = S(40)
    nome_cliente: str | None = S(200)
    contrato_ixc: str | None = S(40)
    cidade: str | None = S(80)
    pppoe: str | None = S(120)
    ip_pppoe: str | None = S(60)
    porta_publica: str | None = S(40)
    ip: str | None = S(60)
    porta: str | None = S(20)
    mac: str | None = S(40)
    modelo: str | None = S(120)
    compressao: str | None = S(20)
    firmware: str | None = S(80)
    dias_gravacao: int | None = Field(default=None, ge=0, le=3650)
    status: Status = "desconhecido"
    observacoes: str | None = S(2000)


class CameraPatch(BaseModel):
    """Mesmos campos de CameraIn, todos opcionais (só o que vier é alterado)."""
    tipo: Tipo | None = None
    nome: str | None = S(200)
    descricao_local: str | None = S(300)
    gravador_id: str | None = S(60)
    canal: int | None = Field(default=None, ge=1, le=512)
    numero_cam: str | None = S(20)
    lg_id: str | None = S(40)
    porta_lifeguard: str | None = S(20)
    porta_monitoramento: str | None = S(20)
    link_provisionamento: str | None = S(500)
    id_cliente_ixc: str | None = S(40)
    nome_cliente: str | None = S(200)
    contrato_ixc: str | None = S(40)
    cidade: str | None = S(80)
    pppoe: str | None = S(120)
    ip_pppoe: str | None = S(60)
    porta_publica: str | None = S(40)
    ip: str | None = S(60)
    porta: str | None = S(20)
    mac: str | None = S(40)
    modelo: str | None = S(120)
    compressao: str | None = S(20)
    firmware: str | None = S(80)
    dias_gravacao: int | None = Field(default=None, ge=0, le=3650)
    status: Status | None = None
    observacoes: str | None = S(2000)


class CameraLoteIn(BaseModel):
    """Várias câmeras do mesmo cliente num cadastro só (tudo ou nada)."""
    cameras: list[CameraIn] = Field(min_length=1, max_length=64)


class FotoIn(BaseModel):
    # JPEG/PNG em base64 (aceita também "data:image/jpeg;base64,...").
    # ~11 MB de texto = 8 MB de imagem; o servidor reduz para 1280 px.
    imagem_base64: str = Field(min_length=100, max_length=11_500_000)


class MapearFotosIn(BaseModel):
    """Nomes dos arquivos escolhidos na importação em lote.
    Com gravador_id: "CANAL 01.jpg", "CH1.jpg"… viram o canal daquele gravador.
    Sem gravador_id: "<id-da-camera>.jpg" (do CSV exportado) ou "LG11157.jpg"."""
    gravador_id: str | None = S(60)
    nomes: list[str] = Field(min_length=1, max_length=600)


class FotoLoteItem(BaseModel):
    camera_id: str = Field(min_length=1, max_length=60)
    imagem_base64: str = Field(min_length=100, max_length=3_000_000)  # já reduzida no navegador
    arquivo: str | None = S(200)


class FotoLoteIn(BaseModel):
    itens: list[FotoLoteItem] = Field(min_length=1, max_length=10)
    substituir: bool = False  # False: câmera que já tem foto fica como está


class GravadorIn(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    origem: Origem = "life"
    url_acesso: str | None = S(300)
    porta_servico: str | None = S(20)
    porta_publica: str | None = S(40)
    dias_gravacao: int | None = Field(default=None, ge=0, le=3650)
    id_cliente_ixc: str | None = S(40)
    nome_cliente: str | None = S(200)
    contrato_ixc: str | None = S(40)
    cidade: str | None = S(80)
    pppoe: str | None = S(120)
    ip_pppoe: str | None = S(60)
    observacoes: str | None = S(2000)


class GravadorPatch(BaseModel):
    nome: str | None = Field(default=None, min_length=1, max_length=200)
    origem: Origem | None = None
    url_acesso: str | None = S(300)
    porta_servico: str | None = S(20)
    porta_publica: str | None = S(40)
    dias_gravacao: int | None = Field(default=None, ge=0, le=3650)
    id_cliente_ixc: str | None = S(40)
    nome_cliente: str | None = S(200)
    contrato_ixc: str | None = S(40)
    cidade: str | None = S(80)
    pppoe: str | None = S(120)
    ip_pppoe: str | None = S(60)
    observacoes: str | None = S(2000)


class CredencialIn(BaseModel):
    gravador_id: str | None = S(60)
    camera_id: str | None = S(60)
    usuario: str = Field(min_length=1, max_length=120)
    nome_cliente: str | None = S(200)  # em NVR Life: de qual cliente é este usuário
    senha: str | None = Field(default=None, max_length=200)


class PermissaoIn(BaseModel):
    colaborador_id: str = Field(min_length=1, max_length=60)
    permissoes: list[str] = Field(default_factory=list, max_length=30)  # lista vazia remove o acesso


class CameraResumo(BaseModel):
    id: str
    tipo: str
    nome: str
    descricao_local: str | None
    gravador_id: str | None
    gravador_nome: str | None
    gravador_origem: str | None
    canal: int | None
    lg_id: str | None
    porta_lifeguard: str | None
    nome_cliente: str | None
    contrato_ixc: str | None
    cidade: str | None
    ip: str | None
    porta: str | None
    mac: str | None
    status: str
    tem_foto: bool
    foto_em: datetime | None
