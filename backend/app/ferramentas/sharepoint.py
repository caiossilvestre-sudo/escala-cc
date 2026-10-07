"""Cliente mínimo do Microsoft Graph para guardar as fotos no SharePoint.

Só usa a biblioteca padrão do Python (urllib), sem dependência nova.
O app do Entra ID precisa de Sites.Selected com permissão "write" no site.

Variáveis no .env:
    FERRAMENTAS_SP_TENANT_ID      id do tenant (Directory ID)
    FERRAMENTAS_SP_CLIENT_ID      Application (client) ID do app
    FERRAMENTAS_SP_CLIENT_SECRET  secret do app
    FERRAMENTAS_SP_SITE           https://lifeservicos.sharepoint.com/sites/IOT2
    FERRAMENTAS_SP_BIBLIOTECA     DocumentacaoLifeGuard
    FERRAMENTAS_SP_PASTA          Fotos
"""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

GRAPH = "https://graph.microsoft.com/v1.0"
TIMEOUT = 20

_lock = threading.Lock()
_cache = {"token": None, "expira": 0, "drive_id": None}


class ErroSharePoint(Exception):
    pass


def _cfg(nome: str, obrigatorio: bool = True) -> str:
    v = os.getenv(nome, "").strip()
    if obrigatorio and not v:
        raise ErroSharePoint(f"{nome} não configurada no .env")
    return v


def _pasta() -> str:
    return os.getenv("FERRAMENTAS_SP_PASTA", "Fotos").strip().strip("/")


class _SemRedirect(urllib.request.HTTPRedirectHandler):
    """O download do Graph responde 302 para um link pré-autenticado; seguimos
    esse link sem mandar o token junto."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_abrir_sem_redirect = urllib.request.build_opener(_SemRedirect).open


def _token() -> str:
    with _lock:
        if _cache["token"] and time.time() < _cache["expira"] - 120:
            return _cache["token"]
        corpo = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": _cfg("FERRAMENTAS_SP_CLIENT_ID"),
            "client_secret": _cfg("FERRAMENTAS_SP_CLIENT_SECRET"),
            "scope": "https://graph.microsoft.com/.default",
        }).encode()
        url = f"https://login.microsoftonline.com/{_cfg('FERRAMENTAS_SP_TENANT_ID')}/oauth2/v2.0/token"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=corpo, method="POST"), timeout=TIMEOUT) as r:
                dados = json.loads(r.read())
        except urllib.error.HTTPError as e:
            detalhe = e.read().decode(errors="ignore")[:300]
            raise ErroSharePoint(f"login no Entra ID recusado ({e.code}): {detalhe}")
        except urllib.error.URLError as e:
            raise ErroSharePoint(f"sem conexão com login.microsoftonline.com: {e.reason}")
        _cache["token"] = dados["access_token"]
        _cache["expira"] = time.time() + int(dados.get("expires_in", 3600))
        return _cache["token"]


def _graph(metodo: str, caminho: str, corpo: bytes | None = None, tipo: str | None = None, sem_redirect=False):
    url = caminho if caminho.startswith("https://") else GRAPH + caminho
    req = urllib.request.Request(url, data=corpo, method=metodo)
    req.add_header("Authorization", f"Bearer {_token()}")
    if tipo:
        req.add_header("Content-Type", tipo)
    abrir = _abrir_sem_redirect if sem_redirect else urllib.request.urlopen
    try:
        return abrir(req, timeout=TIMEOUT)
    except urllib.error.HTTPError as e:
        if sem_redirect and e.code in (301, 302, 303, 307, 308):
            return e  # a resposta de redirecionamento chega como "erro" aqui
        raise


def _drive_id() -> str:
    if _cache["drive_id"]:
        return _cache["drive_id"]
    forcado = os.getenv("FERRAMENTAS_SP_DRIVE_ID", "").strip()
    if forcado:
        _cache["drive_id"] = forcado
        return forcado
    site = urllib.parse.urlparse(_cfg("FERRAMENTAS_SP_SITE"))
    biblioteca = _cfg("FERRAMENTAS_SP_BIBLIOTECA")
    try:
        with _graph("GET", f"/sites/{site.hostname}:{site.path.rstrip('/')}") as r:
            site_id = json.loads(r.read())["id"]
        with _graph("GET", f"/sites/{site_id}/drives?$select=id,name,webUrl") as r:
            drives = json.loads(r.read()).get("value", [])
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ErroSharePoint(f"o app não tem acesso ao site ({e.code}) — falta liberar Sites.Selected/write neste site")
        raise ErroSharePoint(f"site não encontrado ({e.code}): confira FERRAMENTAS_SP_SITE")
    for d in drives:
        if d.get("name") == biblioteca or (d.get("webUrl") or "").rstrip("/").endswith("/" + biblioteca):
            _cache["drive_id"] = d["id"]
            return d["id"]
    nomes = ", ".join(d.get("name", "?") for d in drives)
    raise ErroSharePoint(f"biblioteca '{biblioteca}' não encontrada no site (existem: {nomes})")


def _caminho_item(nome: str) -> str:
    return urllib.parse.quote(f"{_pasta()}/{nome}")


def enviar(nome: str, conteudo: bytes, tipo: str = "image/jpeg"):
    """Grava (ou sobrescreve) Fotos/<nome> na biblioteca."""
    try:
        with _graph("PUT", f"/drives/{_drive_id()}/root:/{_caminho_item(nome)}:/content", conteudo, tipo) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raise ErroSharePoint(f"falha ao enviar {nome} ({e.code}): {e.read().decode(errors='ignore')[:200]}")
    except urllib.error.URLError as e:
        raise ErroSharePoint(f"sem conexão com o SharePoint: {e.reason}")


def baixar(nome: str) -> bytes | None:
    """Conteúdo de Fotos/<nome>, ou None se não existir."""
    try:
        r = _graph("GET", f"/drives/{_drive_id()}/root:/{_caminho_item(nome)}:/content", sem_redirect=True)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise ErroSharePoint(f"falha ao ler {nome} ({e.code})")
    except urllib.error.URLError as e:
        raise ErroSharePoint(f"sem conexão com o SharePoint: {e.reason}")
    with r:
        local = r.headers.get("Location")
        if not local:
            return r.read()
    with urllib.request.urlopen(local, timeout=TIMEOUT) as d:  # link pré-autenticado, sem token
        return d.read()


def apagar(nome: str):
    try:
        with _graph("DELETE", f"/drives/{_drive_id()}/root:/{_caminho_item(nome)}") as r:
            r.read()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise ErroSharePoint(f"falha ao apagar {nome} ({e.code})")
