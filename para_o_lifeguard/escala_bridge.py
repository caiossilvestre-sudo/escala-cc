"""Ponte LifeGuard <-> Escala (módulo Ferramentas · Documentação).

Adicione este arquivo ao projeto do LifeGuard (Flask). Ele cria 3 rotas que
a página do Escala chama direto neste computador:

    GET  /api/escala/ping      -> {"ok": true, "versao": "..."}
    POST /api/escala/detectar  -> {"modelo", "firmware", "mac", "compressao"}
    POST /api/escala/snapshot  -> {"imagem_base64", "largura", "altura"}

Corpo enviado pela página (POST):
    {"tipo": "nvr"|"lifeguard", "ip": "...", "porta": "...", "canal": 3,
     "gravador_url": "http://177.105.135.70:4180/", "lg_id": "11157"}

Como ligar no LifeGuard (no arquivo onde o Flask app é criado):

    from escala_bridge import registrar_ponte_escala
    registrar_ponte_escala(
        app,
        origem_escala="https://escala-suporte.duckdns.org:8043",
        credenciais=minhas_credenciais,   # função: alvo -> [(usuario, senha), ...]
    )

`credenciais` é a lista de usuário/senha que o LifeGuard já usa para entrar
nas câmeras/NVRs (as senhas NÃO vêm do Escala — a página nunca manda senha).
As tentativas são feitas na ordem da lista.

Requisitos: requests (pip install requests) e o ffmpeg que o LifeGuard já
embute (usado só se o snapshot HTTP falhar).

IMPORTANTE: os caminhos HTTP abaixo (ISAPI da Hikvision e CGI da
Intelbras/Dahua) são os padrões desses fabricantes, mas não foram testados
contra os seus equipamentos — confira com 1 câmera de cada marca antes de
liberar para a equipe.
"""
import base64
import re
import shutil
import subprocess
from urllib.parse import urlparse

import requests
from flask import jsonify, request
from requests.auth import HTTPBasicAuth, HTTPDigestAuth

VERSAO = "1.0"
TIMEOUT = 6


# ------------------------------------------------------------------ util

def _base(alvo: dict) -> str | None:
    """URL base do equipamento que vai responder: o NVR (câmera de NVR) ou a
    própria câmera (LifeGuard)."""
    if alvo.get("tipo") == "nvr" and alvo.get("gravador_url"):
        u = urlparse(alvo["gravador_url"].strip())
        return f"{u.scheme or 'http'}://{u.netloc or u.path}".rstrip("/")
    ip = (alvo.get("ip") or "").strip()
    if not ip:
        return None
    porta = (alvo.get("porta") or "").strip()
    # 554/37777/8000 são portas de RTSP/SDK, não de web — usa 80 nesses casos
    if porta and porta not in ("554", "37777", "8000"):
        return f"http://{ip}:{porta}"
    return f"http://{ip}"


def _get(url: str, creds, **kw):
    """Tenta cada credencial com Digest e depois Basic. Devolve a resposta 200."""
    ultimo = None
    for usuario, senha in creds or [("", "")]:
        for auth in (HTTPDigestAuth(usuario, senha), HTTPBasicAuth(usuario, senha)):
            try:
                r = requests.get(url, auth=auth, timeout=TIMEOUT, **kw)
            except requests.RequestException as e:
                ultimo = str(e)
                break  # erro de rede: não adianta trocar de senha
            if r.status_code == 200:
                return r
            ultimo = f"HTTP {r.status_code}"
            if r.status_code != 401:
                break
    raise RuntimeError(ultimo or "sem resposta")


def _canal(alvo) -> int:
    try:
        return max(1, int(alvo.get("canal") or 1))
    except (TypeError, ValueError):
        return 1


def _tamanho_jpeg(dados: bytes):
    """Lê largura/altura do cabeçalho JPEG sem precisar do Pillow."""
    i = 2
    while i < len(dados) - 9:
        if dados[i] != 0xFF:
            i += 1
            continue
        marcador = dados[i + 1]
        if marcador in (0xC0, 0xC1, 0xC2):
            return int.from_bytes(dados[i + 7:i + 9], "big"), int.from_bytes(dados[i + 5:i + 7], "big")
        i += 2 + int.from_bytes(dados[i + 2:i + 4], "big")
    return None, None


# -------------------------------------------------------------- snapshot

def _urls_snapshot(alvo) -> list[str]:
    base = _base(alvo)
    if not base:
        return []
    if alvo.get("tipo") == "nvr":
        ch = _canal(alvo)
        return [
            f"{base}/cgi-bin/snapshot.cgi?channel={ch}",           # Intelbras / Dahua NVR
            f"{base}/ISAPI/Streaming/channels/{ch}01/picture",     # Hikvision NVR
        ]
    return [
        f"{base}/ISAPI/Streaming/channels/101/picture",            # Hikvision câmera
        f"{base}/cgi-bin/snapshot.cgi?channel=1",                  # Intelbras / Dahua câmera
        f"{base}/onvif-http/snapshot?Profile_1",                   # ONVIF genérico
    ]


def _snapshot_rtsp(alvo, creds) -> bytes | None:
    ffmpeg = shutil.which("ffmpeg")
    ip = (alvo.get("ip") or "").strip()
    if not ffmpeg or not ip or alvo.get("tipo") == "nvr":
        return None
    for usuario, senha in creds or [("", "")]:
        for caminho in ("/Streaming/Channels/101", "/cam/realmonitor?channel=1&subtype=0"):
            url = f"rtsp://{usuario}:{senha}@{ip}:554{caminho}"
            try:
                p = subprocess.run(
                    [ffmpeg, "-loglevel", "error", "-rtsp_transport", "tcp", "-i", url,
                     "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1"],
                    capture_output=True, timeout=15,
                )
                if p.returncode == 0 and p.stdout[:2] == b"\xff\xd8":
                    return p.stdout
            except subprocess.TimeoutExpired:
                continue
    return None


def capturar(alvo, creds) -> bytes:
    erros = []
    for url in _urls_snapshot(alvo):
        try:
            r = _get(url, creds)
            if r.content[:2] == b"\xff\xd8":
                return r.content
            erros.append(f"{url}: resposta não é JPEG")
        except RuntimeError as e:
            erros.append(f"{url}: {e}")
    jpg = _snapshot_rtsp(alvo, creds)
    if jpg:
        return jpg
    raise RuntimeError("Não consegui capturar a imagem. " + " | ".join(erros[-3:]))


# -------------------------------------------------------------- detectar

def _tag(xml: str, nome: str):
    m = re.search(rf"<{nome}>([^<]*)</{nome}>", xml)
    return m.group(1).strip() if m else None


def detectar(alvo, creds) -> dict:
    """Só faz sentido falando com a própria câmera (IP dela)."""
    alvo_cam = {**alvo, "tipo": "lifeguard"}  # força usar o IP da câmera, não o NVR
    base = _base(alvo_cam)
    if not base:
        raise RuntimeError("Informe o IP da câmera.")
    # Hikvision
    try:
        info = _get(f"{base}/ISAPI/System/deviceInfo", creds).text
        out = {"modelo": _tag(info, "model"), "firmware": " ".join(filter(None, [_tag(info, "firmwareVersion"), _tag(info, "firmwareReleasedDate")])) or None,
               "mac": _tag(info, "macAddress"), "compressao": None}
        try:
            ch = _get(f"{base}/ISAPI/Streaming/channels/101", creds).text
            out["compressao"] = _tag(ch, "videoCodecType")
        except RuntimeError:
            pass
        return out
    except RuntimeError:
        pass
    # Intelbras / Dahua
    try:
        def cgi(q):
            return _get(f"{base}/cgi-bin/{q}", creds).text
        modelo = cgi("magicBox.cgi?action=getDeviceType").split("=", 1)[-1].strip()
        firmware = cgi("magicBox.cgi?action=getSoftwareVersion").split("=", 1)[-1].strip()
        rede = cgi("configManager.cgi?action=getConfig&name=Network")
        mac = re.search(r"PhysicalAddress=([0-9A-Fa-f:]{17})", rede)
        out = {"modelo": modelo or None, "firmware": firmware or None, "mac": mac.group(1) if mac else None, "compressao": None}
        try:
            enc = cgi("configManager.cgi?action=getConfig&name=Encode")
            c = re.search(r"MainFormat\[0\]\.Video\.Compression=([^\r\n]+)", enc)
            out["compressao"] = c.group(1).strip() if c else None
        except RuntimeError:
            pass
        return out
    except RuntimeError as e:
        raise RuntimeError(f"Não consegui ler os dados do equipamento ({e}).")


# ---------------------------------------------------------------- Flask

def registrar_ponte_escala(app, origem_escala: str, credenciais=None):
    origens = {o.strip().rstrip("/") for o in origem_escala.split(",") if o.strip()}
    credenciais = credenciais or (lambda alvo: [])

    @app.after_request
    def _cors(resp):
        if request.path.startswith("/api/escala/"):
            origem = (request.headers.get("Origin") or "").rstrip("/")
            if origem in origens:
                resp.headers["Access-Control-Allow-Origin"] = origem
                resp.headers["Vary"] = "Origin"
                resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
                resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
                # Chrome exige isto para uma página https chamar o 127.0.0.1
                resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp

    def _alvo():
        return request.get_json(silent=True) or {}

    @app.route("/api/escala/ping", methods=["GET", "OPTIONS"])
    def escala_ping():
        return jsonify({"ok": True, "versao": VERSAO})

    @app.route("/api/escala/snapshot", methods=["POST", "OPTIONS"])
    def escala_snapshot():
        if request.method == "OPTIONS":
            return "", 204
        alvo = _alvo()
        try:
            jpg = capturar(alvo, credenciais(alvo))
        except RuntimeError as e:
            return jsonify({"erro": str(e)}), 502
        largura, altura = _tamanho_jpeg(jpg)
        return jsonify({"imagem_base64": base64.b64encode(jpg).decode("ascii"), "largura": largura, "altura": altura})

    @app.route("/api/escala/detectar", methods=["POST", "OPTIONS"])
    def escala_detectar():
        if request.method == "OPTIONS":
            return "", 204
        alvo = _alvo()
        try:
            return jsonify(detectar(alvo, credenciais(alvo)))
        except RuntimeError as e:
            return jsonify({"erro": str(e)}), 502
