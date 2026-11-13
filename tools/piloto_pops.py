#!/usr/bin/env python3
"""
Piloto - leitura dos POPs do SharePoint (CRL) com a conta do Caio (permissão delegada).

O que este script testa, em ordem:
  1. Login pelo código de dispositivo (uma vez; depois renova sozinho)
  2. Achar a pasta "03 - Procedimentos Operacionais" (pelo atalho do OneDrive ou pelo site do CRL)
  3. Listar os arquivos das pastas 00, 02 e 04 (inventário salvo em JSON)
  4. Testar se a consulta de alterações (delta) funciona na biblioteca
  5. Baixar um PDF de exemplo e extrair texto e imagens

Só LÊ. Não altera nada no SharePoint.

Configuração (variáveis de ambiente):
  POPS_TENANT_ID   ID do diretório (tenant) da Life           [obrigatório]
  POPS_CLIENT_ID   ID do aplicativo registrado no Entra        [obrigatório]
  POPS_ONEDRIVE    caminho no seu OneDrive  (padrão: "06 - WIKI/03 - Procedimentos Operacionais")
  POPS_SITE        site do SharePoint        (padrão: "crl")
  POPS_LIBPATH     caminho na biblioteca     (padrão: "07 - WIKI/03 - Procedimentos Operacionais")
  POPS_PASTAS      prefixos das subpastas    (padrão: "00,02,04")
  POPS_DIR         pasta de trabalho         (padrão: ~/.pops_piloto)
"""
import json, os, re, stat, sys, time
from pathlib import Path
from urllib.parse import quote

try:
    import msal, requests
except ImportError:
    sys.exit("Faltam bibliotecas. Rode: pip install msal requests pymupdf")

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ["Files.Read.All", "Sites.Read.All"]

TENANT = os.environ.get("POPS_TENANT_ID", "").strip()
CLIENT = os.environ.get("POPS_CLIENT_ID", "").strip()
ONEDRIVE_PATH = os.environ.get("POPS_ONEDRIVE", "06 - WIKI/03 - Procedimentos Operacionais")
SITE = os.environ.get("POPS_SITE", "crl")
LIBPATH = os.environ.get("POPS_LIBPATH", "07 - WIKI/03 - Procedimentos Operacionais")
PASTAS = [p.strip() for p in os.environ.get("POPS_PASTAS", "00,02,04").split(",") if p.strip()]
WORK = Path(os.environ.get("POPS_DIR", Path.home() / ".pops_piloto"))

# Erros de login mais prováveis e o que significam
ERROS = {
    "AADSTS65001": "A Life exige aprovação do administrador para este aplicativo (consentimento bloqueado para usuários).",
    "AADSTS90094": "A Life exige aprovação do administrador para este aplicativo.",
    "AADSTS900941": "A Life exige aprovação do administrador para este aplicativo.",
    "AADSTS53003": "Bloqueado por política de acesso condicional (ex.: só dispositivo/rede da empresa).",
    "AADSTS53000": "Bloqueado por política: o 365 exige dispositivo gerenciado pela empresa.",
    "AADSTS7000218": "No Entra, ligue 'Permitir fluxos de cliente público' em Autenticação do aplicativo.",
    "AADSTS700016": "POPS_CLIENT_ID não encontrado nesse tenant (confira o ID do aplicativo e do diretório).",
    "AADSTS90002": "POPS_TENANT_ID inválido.",
}


def ok(msg): print(f"  [OK]   {msg}")
def falha(msg): print(f"  [FALHA] {msg}")
def info(msg): print(f"         {msg}")


def explicar(texto):
    for cod, desc in ERROS.items():
        if cod in (texto or ""):
            return f"{cod}: {desc}"
    return (texto or "erro desconhecido")[:400]


# ---------------------------------------------------------------- 1. login
def obter_token():
    WORK.mkdir(parents=True, exist_ok=True)
    os.chmod(WORK, stat.S_IRWXU)
    cache_file = WORK / "token_cache.json"
    cache = msal.SerializableTokenCache()
    if cache_file.exists():
        cache.deserialize(cache_file.read_text())

    app = msal.PublicClientApplication(
        CLIENT, authority=f"https://login.microsoftonline.com/{TENANT}", token_cache=cache)

    result = None
    contas = app.get_accounts()
    if contas:
        result = app.acquire_token_silent(SCOPES, account=contas[0])
        if result and "access_token" in result:
            ok(f"Sessão reaproveitada ({contas[0].get('username')}) - renovação automática funcionando")

    if not result or "access_token" not in result:
        flow = app.initiate_device_flow(scopes=SCOPES)
        if "user_code" not in flow:
            falha("Não consegui iniciar o login: " + explicar(flow.get("error_description")))
            sys.exit(1)
        print("\n  >>> " + flow["message"] + "\n")
        result = app.acquire_token_by_device_flow(flow)
        if "access_token" not in result:
            falha("Login recusado - " + explicar(result.get("error_description")))
            sys.exit(1)
        ok(f"Login feito como {result.get('id_token_claims', {}).get('preferred_username', '?')}")

    if cache.has_state_changed:
        cache_file.write_text(cache.serialize())
        os.chmod(cache_file, stat.S_IRUSR | stat.S_IWUSR)
    return result["access_token"]


# ---------------------------------------------------------------- Graph helpers
class Graph:
    def __init__(self, token):
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {token}"

    def get(self, url, **kw):
        if not url.startswith("http"):
            url = GRAPH + url
        for tentativa in range(4):
            r = self.s.get(url, timeout=60, **kw)
            if r.status_code in (429, 503):
                time.sleep(int(r.headers.get("Retry-After", 5)))
                continue
            return r
        return r

    def json(self, url):
        r = self.get(url)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code} em {url.replace(GRAPH, '')}: {explicar(r.text)}")
        return r.json()

    def listar(self, url):
        itens = []
        while url:
            d = self.json(url)
            itens += d.get("value", [])
            url = d.get("@odata.nextLink")
        return itens


def p(path):  # codifica caminho para a URL do Graph
    return quote(path.strip("/"), safe="/")


# ---------------------------------------------------------------- 2. achar a pasta
def pelo_onedrive(g):
    """Percorre o caminho no OneDrive; se encontrar um atalho, salta para a biblioteca original."""
    drive_id, item_id = None, None
    partes = ONEDRIVE_PATH.strip("/").split("/")
    for i, parte in enumerate(partes):
        if drive_id is None:
            it = g.json(f"/me/drive/root:/{p(parte)}")
        else:
            it = g.json(f"/drives/{drive_id}/items/{item_id}:/{p(parte)}")
        if "remoteItem" in it:  # atalho para pasta do SharePoint
            rem = it["remoteItem"]
            drive_id, item_id = rem["parentReference"]["driveId"], rem["id"]
            info(f"'{parte}' é um atalho para a biblioteca do SharePoint")
        else:
            drive_id = drive_id or it["parentReference"]["driveId"]
            item_id = it["id"]
    return drive_id, item_id


def pelo_site(g):
    """Descobre o endereço do SharePoint pela URL do seu OneDrive e acessa o site do CRL."""
    me = g.json("/me/drive?$select=webUrl")
    host = re.match(r"https://([^/]+)", me["webUrl"]).group(1).replace("-my.sharepoint.com", ".sharepoint.com")
    site = g.json(f"/sites/{host}:/sites/{SITE}?$select=id,webUrl")
    info(f"Site: {site['webUrl']}")
    drives = g.listar(f"/sites/{site['id']}/drives?$select=id,name,webUrl")
    drv = next((d for d in drives if d["webUrl"].rstrip("/").endswith("Shared%20Documents")), None) \
        or next((d for d in drives if d["name"] in ("Documentos", "Documents", "Documentos Compartilhados")), None)
    if not drv:
        raise RuntimeError("Biblioteca 'Documentos' não encontrada. Bibliotecas: " + ", ".join(d["name"] for d in drives))
    it = g.json(f"/drives/{drv['id']}/root:/{p(LIBPATH)}")
    return drv["id"], it["id"]


def achar_pasta(g):
    for nome, fn in (("atalho do OneDrive", pelo_onedrive), ("site do CRL", pelo_site)):
        try:
            d, i = fn(g)
            it = g.json(f"/drives/{d}/items/{i}?$select=name,webUrl")
            ok(f"Pasta encontrada pelo {nome}: {it['webUrl']}")
            return d, i, nome
        except Exception as e:
            falha(f"Pelo {nome}: {e}")
    sys.exit("\nNão consegui chegar à pasta dos procedimentos. Veja os erros acima.")


# ---------------------------------------------------------------- 3. inventário
def percorrer(g, drive_id, item_id, caminho, saida):
    for it in g.listar(f"/drives/{drive_id}/items/{item_id}/children"
                       "?$select=id,name,size,lastModifiedDateTime,webUrl,eTag,folder,file&$top=200"):
        rel = f"{caminho}/{it['name']}"
        if "folder" in it:
            percorrer(g, drive_id, it["id"], rel, saida)
        else:
            m = re.search(r"PG-ST\d{3}", it["name"])
            saida.append({
                "caminho": rel.lstrip("/"), "codigo": m.group(0) if m else None, "id": it["id"],
                "tamanho": it.get("size"), "modificado": it.get("lastModifiedDateTime"),
                "etag": it.get("eTag"), "url": it.get("webUrl"),
            })


def inventario(g, drive_id, raiz_id):
    subs = [s for s in g.listar(f"/drives/{drive_id}/items/{raiz_id}/children?$select=id,name,folder")
            if "folder" in s and any(s["name"].startswith(x) for x in PASTAS)]
    if not subs:
        falha(f"Nenhuma subpasta começando com {PASTAS}")
        return []
    todos = []
    for s in sorted(subs, key=lambda x: x["name"]):
        arqs = []
        percorrer(g, drive_id, s["id"], s["name"], arqs)
        pops = [a for a in arqs if a["codigo"]]
        info(f"{s['name']}: {len(arqs)} arquivos ({len(pops)} POPs PG-ST)")
        todos += arqs
    (WORK / "inventario.json").write_text(json.dumps(todos, ensure_ascii=False, indent=1))
    ok(f"Inventário: {len(todos)} arquivos -> {WORK / 'inventario.json'}")
    return todos


# ---------------------------------------------------------------- 4. delta
def testar_delta(g, drive_id):
    r = g.get(f"/drives/{drive_id}/root/delta?token=latest")
    if r.status_code == 200 and "@odata.deltaLink" in r.json():
        (WORK / "delta_link.txt").write_text(r.json()["@odata.deltaLink"])
        ok("Consulta de alterações (delta) disponível - a sincronização pode baixar só o que mudou")
    else:
        falha(f"Delta indisponível (HTTP {r.status_code}) - a sincronização terá que comparar a lista inteira, "
              "o que também funciona: " + explicar(r.text))


# ---------------------------------------------------------------- 5. PDF de exemplo
def testar_pdf(g, drive_id, todos):
    pdfs = [a for a in todos if a["caminho"].lower().endswith(".pdf") and a["codigo"]]
    if not pdfs:
        falha("Nenhum PDF de POP para testar a extração")
        return
    alvo = max(pdfs, key=lambda a: a["modificado"] or "")
    r = g.get(f"/drives/{drive_id}/items/{alvo['id']}/content")
    if r.status_code != 200:
        falha(f"Download recusado (HTTP {r.status_code})")
        return
    dest = WORK / "exemplo"
    dest.mkdir(exist_ok=True)
    arq = dest / Path(alvo["caminho"]).name
    arq.write_bytes(r.content)
    ok(f"Baixado: {alvo['caminho']} ({len(r.content) // 1024} KB)")

    try:
        import pymupdf
    except ImportError:
        info("pymupdf não instalado - pulei a extração (pip install pymupdf)")
        return
    doc = pymupdf.open(arq)
    texto = "".join(pg.get_text() for pg in doc)
    n_img, salvas = 0, 0
    for i, pg in enumerate(doc):
        for img in pg.get_images(full=True):
            n_img += 1
            if salvas < 3:
                pix = pymupdf.Pixmap(doc, img[0])
                if pix.n - pix.alpha >= 4:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                if pix.width >= 200:
                    pix.save(dest / f"img_p{i + 1}_{salvas + 1}.png")
                    salvas += 1
    ok(f"Extração: {doc.page_count} páginas, {len(texto)} caracteres de texto, {n_img} imagens "
       f"({salvas} salvas em {dest})")
    print("\n  --- início do texto extraído ---")
    for linha in [l for l in texto.splitlines() if l.strip()][:25]:
        print("  | " + linha[:110])
    print("  --- fim ---")


# ---------------------------------------------------------------- main
def main():
    if not TENANT or not CLIENT:
        sys.exit("Defina POPS_TENANT_ID e POPS_CLIENT_ID (veja o LEIA-ME).")
    print("\n1) Login")
    g = Graph(obter_token())
    print("\n2) Localizar a pasta dos procedimentos")
    drive_id, raiz_id, _ = achar_pasta(g)
    print("\n3) Inventário das pastas", ", ".join(PASTAS))
    todos = inventario(g, drive_id, raiz_id)
    print("\n4) Consulta de alterações")
    testar_delta(g, drive_id)
    print("\n5) PDF de exemplo")
    testar_pdf(g, drive_id, todos)
    print("\nPiloto concluído. Me mande a saída desta tela (pode colar o texto).\n")


if __name__ == "__main__":
    main()
