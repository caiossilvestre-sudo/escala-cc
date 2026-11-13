"""Procedimentos (POPs): leitura dos PDFs e busca.

Os PDFs chegam do PC do Caio (script agendado todo dia às 9h que lê a pasta do
OneDrive sincronizada com o SharePoint do CRL). Aqui:
  - o PDF é guardado em disco (FERRAMENTAS_POPS_DIR);
  - o texto é separado em trechos por seção (títulos em negrito), cada um com
    os prints que aparecem naquela parte;
  - a busca roda em memória (são poucas centenas de trechos), sem depender de
    recurso específico do Postgres.

O SharePoint continua sendo o documento oficial: a tela sempre mostra o link
do PDF lá.
"""
import hashlib
import io
import math
import os
import re
import threading
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote

from PIL import Image

SP_BASE_PADRAO = "https://lifeservicos.sharepoint.com/sites/crl/Shared Documents/07 - WIKI/03 - Procedimentos Operacionais"
TAM_MAX = 11 * 1024 * 1024        # o Nginx aceita até 12 MB por requisição
PAGINAS_MAX = 250
IMAGENS_MAX = 300
TRECHO_MAX = 1400                 # caracteres por trecho antes de quebrar


def pasta_pops() -> Path:
    p = Path(os.getenv("FERRAMENTAS_POPS_DIR", "./data/ferramentas/pops")).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def link_sharepoint(caminho: str) -> str:
    base = os.getenv("FERRAMENTAS_POPS_SP_BASE", SP_BASE_PADRAO).rstrip("/")
    return quote(f"{base}/{caminho}", safe=":/")


def caminho_valido(caminho: str) -> str | None:
    """Normaliza e recusa qualquer coisa que saia da pasta ou não seja PDF."""
    c = (caminho or "").replace("\\", "/").strip().strip("/")
    partes = [p for p in c.split("/") if p not in ("", ".")]
    if not partes or any(p == ".." for p in partes) or not partes[-1].lower().endswith(".pdf"):
        return None
    return "/".join(partes)


def nome_arquivo_seguro(nome: str) -> Path | None:
    if not re.fullmatch(r"[A-Za-z0-9-]+\.jpg", nome or ""):   # o PDF em si nunca sai pela API
        return None
    return pasta_pops() / nome


# ------------------------------------------------------------- identificação

RE_NOME = re.compile(r"(PG-ST\d{3})(?:-N2)?(?:\s+v(\d{3}))?\s*[-–]\s*(.+?)\.pdf$", re.I)


def identificar(caminho: str, titulo_pdf: str | None, texto_capa: str) -> dict:
    nome = caminho.rsplit("/", 1)[-1]
    codigo, versao, titulo = None, None, nome[:-4]
    m = RE_NOME.search(nome)
    if m:
        codigo, versao, titulo = m.group(1).upper(), m.group(2), m.group(3).strip()
    # Título do próprio PDF ("PG-ST111 – Monitoramento – ...") tem acentos; o nome do arquivo não
    if titulo_pdf and codigo and titulo_pdf.upper().startswith(codigo):
        t = re.sub(r"^PG-ST\d{3}\s*[-–]\s*", "", titulo_pdf, flags=re.I).strip()
        if t:
            titulo = t
    mv = re.search(r"VER(?:SÃO)?\s*:\s*(\d{3})", texto_capa or "", re.I)
    if mv:
        versao = mv.group(1)
    if not codigo:
        mc = re.search(r"C[ÓO]DIGO\s*:\s*(PG-ST\d{3})", texto_capa or "", re.I)
        if mc:
            codigo = mc.group(1).upper()
    return {"codigo": codigo, "versao": versao, "titulo": titulo, "pasta": caminho.split("/", 1)[0]}


# ------------------------------------------------------------- extração

def _jpeg(bruto: bytes) -> bytes | None:
    try:
        img = Image.open(io.BytesIO(bruto))
        if img.width < 150 or img.height < 60:
            return None
        if img.mode not in ("RGB", "L"):
            fundo = Image.new("RGB", img.size, "white")
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGBA")
                fundo.paste(img, mask=img.split()[-1])
            else:
                fundo.paste(img.convert("RGB"))
            img = fundo
        if img.width > 1100:
            img = img.resize((1100, round(img.height * 1100 / img.width)))
        out = io.BytesIO()
        img.convert("RGB").save(out, "JPEG", quality=80)
        return out.getvalue()
    except Exception:
        return None


def _eh_titulo(texto: str, span: dict) -> bool:
    t = texto.strip()
    if not t or len(t) > 70 or t.endswith((".", ",", ";")) or t.lower().startswith(("nota", "fonte", "exemplo", "atenção", "importante")):
        return False
    negrito = bool(span["flags"] & 16) or "bold" in span["font"].lower()
    return negrito and span["size"] >= 11.5


def extrair(pdf: bytes, caminho: str, pop_id: str) -> dict:
    """Lê o PDF e devolve identificação + trechos. Grava os prints em disco."""
    import pymupdf  # importado aqui: só o processo que sincroniza precisa

    doc = pymupdf.open(stream=pdf, filetype="pdf")
    n_pag = min(doc.page_count, PAGINAS_MAX)
    capa = doc[0].get_text() if doc.page_count else ""
    ident = identificar(caminho, (doc.metadata or {}).get("title"), capa)

    # Lê cada página uma vez: linhas de texto e imagens (com a "impressão digital"
    # da imagem para achar logo/cabeçalho que se repete em todas as páginas)
    # (duas leituras: guardar as imagens de todas as páginas de um manual grande pesa na memória)
    def blocos_da(p):
        bls = doc[p].get_text("dict")["blocks"]
        for bl in bls:
            if bl["type"] == 1 and bl.get("image"):
                bl["_dig"] = hashlib.md5(bl["image"]).hexdigest()
        return bls

    freq = Counter()
    for p in range(n_pag):
        freq.update({bl["_dig"] for bl in blocos_da(p) if bl.get("_dig")})
    repetidas = {d for d, n in freq.items() if n_pag >= 3 and n >= max(3, n_pag * 0.4)}

    trechos, atual = [], None
    salvas, imagens_feitas = {}, 0
    h1 = h2 = None
    pular_secao = False

    def fechar():
        nonlocal atual
        if atual and (atual["linhas"] or atual["imagens"]):
            texto = re.sub(r"[ \t]+", " ", "\n".join(atual["linhas"])).strip()
            if texto or atual["imagens"]:
                trechos.append({"pagina": atual["pagina"], "secao": atual["secao"], "texto": texto, "imagens": atual["imagens"]})
        atual = None

    def novo(pagina):
        nonlocal atual
        secao = " › ".join(s for s in (h1, h2) if s) or None
        atual = {"pagina": pagina, "secao": secao, "linhas": [], "imagens": [], "tam": 0}

    for p in range(n_pag):
        altura, blocos = doc[p].rect.height, blocos_da(p)
        itens = []
        for b in blocos:
            if b["type"] == 1:
                y0, y1 = b["bbox"][1], b["bbox"][3]
                d = b.get("_dig")
                if d and d not in repetidas and y1 >= altura * 0.12 and y0 <= altura * 0.9:
                    itens.append((y0, b["bbox"][0], "i", d, b))
                continue
            if b["type"] != 0:
                continue
            for ln in b["lines"]:
                spans = [s for s in ln["spans"] if s["text"].strip()]
                if not spans:
                    continue
                txt = "".join(s["text"] for s in ln["spans"]).strip()
                y = ln["bbox"][1]
                if y < altura * 0.11 or y > altura * 0.92:   # cabeçalho/rodapé
                    continue
                itens.append((y, ln["bbox"][0], "t", txt, spans[0]))
        itens.sort(key=lambda t: (round(t[0]), t[1]))

        for _y, _x, tipo, val, span in itens:  # span = bloco da imagem quando tipo == "i"
            if tipo == "t":
                if re.search(r"\.{6,}", val) or val.lower() in ("sumário", "sumario"):
                    continue  # sumário
                if _eh_titulo(val, span):
                    if span["size"] >= 13.5 or val.isupper():
                        curto = len(val) <= 5 and " " not in val          # sigla: IXC, PRTG, UNM
                        h1, h2 = (val if curto else val.capitalize()) if val.isupper() else val, None
                    else:
                        h2 = val
                    pular_secao = (h1 or "").lower().startswith("histórico de alterações")
                    fechar()
                    if not pular_secao:
                        novo(p + 1)
                    continue
                if pular_secao or p == 0:
                    continue
                if atual is None:
                    novo(p + 1)
                if atual["tam"] > TRECHO_MAX and atual["linhas"] and atual["linhas"][-1].endswith((".", ":")):
                    fechar(); novo(p + 1)
                atual["linhas"].append(val)
                atual["tam"] += len(val)
            else:
                if pular_secao or p == 0 or imagens_feitas >= IMAGENS_MAX:
                    continue
                if val not in salvas:
                    jpg = _jpeg(span["image"])
                    salvas[val] = None
                    if jpg:
                        nome = f"{pop_id}-{val[:12]}.jpg"
                        (pasta_pops() / nome).write_bytes(jpg)
                        salvas[val] = nome
                        imagens_feitas += 1
                if salvas[val]:
                    if atual is None:
                        novo(p + 1)
                    atual["imagens"].append(salvas[val])
    fechar()

    # Junta linhas quebradas no meio da frase (o PDF quebra por largura de página)
    for t in trechos:
        t["texto"] = re.sub(r"(?<![.:;!?\n])\n(?=[a-zà-ú(“\"0-9])", " ", t["texto"])
    return {**ident, "paginas": doc.page_count, "trechos": trechos}


def pagina_jpg(pop_id: str, n: int) -> bytes | None:
    """Página n (1, 2...) do PDF como imagem, para ver no sistema sem baixar o
    arquivo. Fica em cache em disco; some junto com os prints quando o POP muda."""
    import pymupdf

    cache = pasta_pops() / f"{pop_id}-pag{n:03d}.jpg"
    if cache.exists():
        return cache.read_bytes()
    pdf = pasta_pops() / f"{pop_id}.pdf"
    if not pdf.exists():
        return None
    with pymupdf.open(pdf) as doc:
        if n < 1 or n > doc.page_count:
            return None
        pix = doc[n - 1].get_pixmap(dpi=130)
        jpg = pix.tobytes("jpeg", jpg_quality=82)
    cache.write_bytes(jpg)
    return jpg


def apagar_imagens(pop_id: str):
    for f in pasta_pops().glob(f"{pop_id}-*.jpg"):
        try:
            f.unlink()
        except OSError:
            pass


def sha256(dados: bytes) -> str:
    return hashlib.sha256(dados).hexdigest()


# ------------------------------------------------------------- busca

PARADAS = set("""a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra pro
com sem e ou que se ao aos à às é ser foi como qual quais quando onde porque porquê sobre entre até mais menos
muito muita meu minha seu sua isso isto esse essa este esta ele ela eles elas eu nós vc você voce cliente clientes
fazer faço faz tem ter está esta estão estao procedimento procedimentos pop como nao não""".split())

# Termos que o atendente usa x termos dos POPs (sem acento, minúsculo)
SINONIMOS = {
    "internet": ["acesso", "conexao", "navegacao"], "net": ["internet", "acesso"],
    "lento": ["lentidao"], "lenta": ["lentidao"], "lentidao": ["lento"],
    "caindo": ["quedas", "queda"], "cai": ["quedas", "queda"], "queda": ["quedas"], "oscilando": ["quedas"],
    "wifi": ["ssid", "wireless", "rede"], "wi": ["ssid"], "ssid": ["wifi"],
    "camera": ["cameras", "lifeguard", "cam"], "cam": ["camera"], "imagem": ["imagem", "video"],
    "modem": ["onu", "roteador", "equipamento"], "roteador": ["onu", "equipamento"], "onu": ["ont", "roteador"],
    "ramal": ["ramais", "pabx"], "pabx": ["ramal", "centrex", "cloud"], "telefone": ["telefonia", "ramal", "voip"],
    "alarme": ["alarmes", "central"], "nvr": ["gravador", "dvr"], "dvr": ["nvr", "gravador"], "gravador": ["nvr"],
    "porta": ["portas", "redirecionamento"], "liberar": ["redirecionamento", "liberacao"],
    "tv": ["iptv", "hdtv", "stb"], "senha": ["senha", "pppoe"], "remoto": ["remoto", "acesso"],
}


def _sem_acento(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _raiz(p: str) -> str:
    if len(p) > 4 and p.endswith("s"):
        p = p[:-1]
    return p[:6] if len(p) > 6 else p


def termos(texto: str) -> list[str]:
    return [_raiz(p) for p in re.findall(r"[a-z0-9]+", _sem_acento(texto)) if len(p) >= 2 and p not in PARADAS]


def termos_consulta(q: str) -> dict[str, float]:
    """Termos com peso: o que a pessoa digitou vale 1, sinônimo vale 0,5."""
    pesos = {}
    for p in re.findall(r"[a-z0-9]+", _sem_acento(q)):
        if len(p) < 2 or p in PARADAS:
            continue
        pesos[_raiz(p)] = 1.0
        for s in SINONIMOS.get(p, []):
            pesos.setdefault(_raiz(s), 0.5)
    return pesos


GENERICAS = {"objetivo", "responsabilidade", "fluxograma", "contextualizacao"}


class Indice:
    """BM25 simples sobre os trechos. Título e seção pesam mais que o texto."""

    def __init__(self, linhas):
        # linhas: (trecho_id, pop_id, codigo, titulo, secao, texto, sha256)
        # (o mesmo PDF em duas pastas — ex.: "Uso comum" — conta como um só pelo sha256)
        self.docs, self.df = [], Counter()
        for tid, pid, cod, tit, sec, txt, sha in linhas:
            tf = Counter()
            for t in termos(tit or ""):
                tf[t] += 3
            for t in termos(sec or ""):
                tf[t] += 2
            for t in termos(txt or ""):
                tf[t] += 1
            self.docs.append((tid, sha or pid, (cod or "").upper(), tf, sum(tf.values()) or 1, _sem_acento(sec or "")))
            self.df.update(tf.keys())
        self.n = len(self.docs) or 1
        self.media = sum(d[4] for d in self.docs) / self.n if self.docs else 1

    def buscar(self, q: str, limite: int = 8, por_pop: int = 2):
        pesos = termos_consulta(q)
        cods = {f"PG-ST{c}" for c in re.findall(r"(?:st|pg-st|pop)\s*-?\s*(\d{3})", _sem_acento(q))}
        if not pesos and not cods:
            return [], []
        k1, b = 1.4, 0.7
        pont = []
        for tid, pid, cod, tf, tam, sec in self.docs:
            s = 0.0
            for t, w in pesos.items():
                f = tf.get(t)
                if not f:
                    continue
                idf = math.log(1 + (self.n - self.df[t] + 0.5) / (self.df[t] + 0.5))
                s += w * idf * f * (k1 + 1) / (f + k1 * (1 - b + b * tam / self.media))
            if cod in cods:
                s += 20
            if sec in GENERICAS:
                s *= 0.6
            if s > 0:
                pont.append((s, tid, pid))
        pont.sort(reverse=True)
        saida, conta = [], defaultdict(int)
        for s, tid, pid in pont:
            if conta[pid] >= por_pop:
                continue
            conta[pid] += 1
            saida.append((tid, round(s, 2)))
            if len(saida) >= limite:
                break
        return saida, list(pesos)


_cache = {"chave": None, "indice": None}
_trava = threading.Lock()


def indice(db, chave) -> "Indice":
    """Reconstrói só quando a sincronização mudou algo (chave = qtd + última data)."""
    with _trava:
        if _cache["chave"] != chave:
            from app.ferramentas.models import FtPop, FtPopTrecho
            vistos, linhas = {}, []
            for ln in (db.query(FtPopTrecho.id, FtPop.id, FtPop.codigo, FtPop.titulo, FtPopTrecho.secao, FtPopTrecho.texto,
                                FtPop.sha256, FtPopTrecho.ordem)
                       .join(FtPop, FtPop.id == FtPopTrecho.pop_id).order_by(FtPop.caminho).all()):
                # cópia idêntica em outra pasta: fica só a primeira
                if vistos.setdefault((ln[6], ln[7]), ln[1]) != ln[1]:
                    continue
                linhas.append(ln[:7])
            _cache["indice"], _cache["chave"] = Indice(linhas), chave
        return _cache["indice"]
