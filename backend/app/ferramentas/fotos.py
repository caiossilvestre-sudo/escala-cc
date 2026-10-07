"""Foto da documentação: uma por câmera, no disco do servidor ou no SharePoint.

A imagem que chega (arquivo importado pelo navegador) é sempre reaberta e
regravada pelo Pillow: isso confirma que é uma imagem de verdade, remove
metadados (EXIF) e padroniza em JPEG de no máximo 1280 px de largura.
Nome do arquivo: <id-da-camera>.jpg — atualizar sobrescreve.
"""
import base64
import binascii
import io
import os
from pathlib import Path

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

LARGURA_MAX = 1280
QUALIDADE_JPEG = 80
TAMANHO_MAX_ENTRADA = 8 * 1024 * 1024  # 8 MB depois de decodificar o base64
Image.MAX_IMAGE_PIXELS = 40_000_000     # evita "bomba" de descompressão


def pasta_fotos() -> Path:
    pasta = Path(os.getenv("FERRAMENTAS_FOTOS_DIR", "./data/ferramentas/fotos")).resolve()
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def _caminho(camera_id: str) -> Path:
    # camera_id é um UUID gerado pelo próprio sistema; mesmo assim, nunca
    # deixa sair da pasta de fotos.
    nome = "".join(c for c in camera_id if c.isalnum() or c == "-")
    return pasta_fotos() / f"{nome}.jpg"


def decodificar_base64(dado: str) -> bytes:
    if "," in dado[:100] and dado.startswith("data:"):
        dado = dado.split(",", 1)[1]
    try:
        bruto = base64.b64decode(dado, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Imagem inválida (base64).")
    if len(bruto) > TAMANHO_MAX_ENTRADA:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Imagem grande demais (máx. 8 MB).")
    return bruto


def normalizar_imagem(bruto: bytes) -> tuple[bytes, int, int]:
    try:
        img = Image.open(io.BytesIO(bruto))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O arquivo enviado não é uma imagem válida.")
    img = img.convert("RGB")
    if img.width > LARGURA_MAX:
        altura = round(img.height * LARGURA_MAX / img.width)
        img = img.resize((LARGURA_MAX, altura), Image.LANCZOS)
    saida = io.BytesIO()
    img.save(saida, format="JPEG", quality=QUALIDADE_JPEG, optimize=True)
    return saida.getvalue(), img.width, img.height


# ------------------------------------------------------------- onde guardar
#
# FERRAMENTAS_FOTOS_DESTINO=disco (padrão) ou sharepoint.
# No banco, ft_cameras.foto_arquivo guarda o nome do arquivo; quando a foto
# está no SharePoint ele começa com "sp:" (ex.: "sp:<id>.jpg"). Assim fotos
# antigas no disco continuam abrindo até serem migradas
# (python -m app.ferramentas.migrar_fotos_sharepoint).

PREFIXO_SP = "sp:"


def destino_sharepoint() -> bool:
    return os.getenv("FERRAMENTAS_FOTOS_DESTINO", "disco").strip().lower() == "sharepoint"


def _nome_arquivo(camera_id: str) -> str:
    # camera_id é um UUID gerado pelo próprio sistema; mesmo assim, só
    # letras, números e hífen entram no nome.
    return "".join(c for c in camera_id if c.isalnum() or c == "-") + ".jpg"


def _erro_sp(e) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Não foi possível acessar as fotos no SharePoint: {e}")


def salvar(camera_id: str, jpeg: bytes) -> str:
    """Grava a foto e devolve o valor para ft_cameras.foto_arquivo."""
    if destino_sharepoint():
        from app.ferramentas import sharepoint
        nome = _nome_arquivo(camera_id)
        try:
            sharepoint.enviar(nome, jpeg)
        except sharepoint.ErroSharePoint as e:
            raise _erro_sp(e)
        return PREFIXO_SP + nome
    destino = _caminho(camera_id)
    temp = destino.with_suffix(".tmp")
    temp.write_bytes(jpeg)
    os.replace(temp, destino)  # troca atômica: nunca fica meia foto no disco
    return destino.name


def ler_bytes(arquivo: str) -> bytes | None:
    if arquivo.startswith(PREFIXO_SP):
        from app.ferramentas import sharepoint
        try:
            return sharepoint.baixar(Path(arquivo[len(PREFIXO_SP):]).name)
        except sharepoint.ErroSharePoint as e:
            raise _erro_sp(e)
    caminho = pasta_fotos() / Path(arquivo).name
    return caminho.read_bytes() if caminho.exists() else None


def ler_base64(arquivo: str) -> str | None:
    dado = ler_bytes(arquivo)
    return base64.b64encode(dado).decode("ascii") if dado else None


def apagar(arquivo: str | None):
    """Apaga sem derrubar a operação principal se o arquivo já não existir."""
    if not arquivo:
        return
    if arquivo.startswith(PREFIXO_SP):
        from app.ferramentas import sharepoint
        try:
            sharepoint.apagar(Path(arquivo[len(PREFIXO_SP):]).name)
        except sharepoint.ErroSharePoint as e:
            print(f"[ferramentas] aviso: não apagou {arquivo} no SharePoint: {e}")
        return
    caminho = pasta_fotos() / Path(arquivo).name
    try:
        caminho.unlink(missing_ok=True)
    except OSError:
        pass
