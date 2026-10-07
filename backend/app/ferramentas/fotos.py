"""Foto da documentação: uma por câmera, guardada em disco no servidor.

A imagem que chega (do LifeGuard ou do navegador) é sempre reaberta e
regravada pelo Pillow: isso confirma que é uma imagem de verdade, remove
metadados (EXIF) e padroniza em JPEG de no máximo 1280 px de largura.
Fica em FERRAMENTAS_FOTOS_DIR/<id-da-camera>.jpg — atualizar sobrescreve.
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


def salvar(camera_id: str, jpeg: bytes) -> str:
    destino = _caminho(camera_id)
    temp = destino.with_suffix(".tmp")
    temp.write_bytes(jpeg)
    os.replace(temp, destino)  # troca atômica: nunca fica meia foto no disco
    return destino.name


def ler_base64(arquivo: str) -> str | None:
    caminho = pasta_fotos() / Path(arquivo).name
    if not caminho.exists():
        return None
    return base64.b64encode(caminho.read_bytes()).decode("ascii")


def apagar(arquivo: str | None):
    if not arquivo:
        return
    caminho = pasta_fotos() / Path(arquivo).name
    try:
        caminho.unlink(missing_ok=True)
    except OSError:
        pass
