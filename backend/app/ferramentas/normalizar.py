"""Padronização dos dados — usada tanto na importação da planilha quanto
nos cadastros feitos pela tela/LifeGuard, para os dados não voltarem a
ficar bagunçados (MAC em 3 formatos, cidade escrita de 4 jeitos etc.)."""
import ipaddress
import re
import unicodedata

VAZIOS = {"", "-", "--", "—", "#n/a", "n/a", "na", "none", "null", "x", "?"}


def texto(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).replace("\xa0", " ").replace("\t", " ").strip()
    s = re.sub(r"\s+", " ", s)
    return None if s.lower() in VAZIOS else s


def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


CIDADES = {
    "marilia": "Marília", "garca": "Garça", "pompeia": "Pompeia", "ocaucu": "Ocauçu",
    "quintana": "Quintana", "vera cruz": "Vera Cruz", "oriente": "Oriente", "lupercio": "Lupércio",
    "alvaro de carvalho": "Álvaro de Carvalho", "julio mesquita": "Júlio Mesquita", "echapora": "Echaporã",
    "oscar bressane": "Oscar Bressane", "padre nobrega": "Padre Nóbrega", "avencas": "Avencas",
    "lacio": "Lácio", "amadeu amaral": "Amadeu Amaral", "dirceu": "Dirceu", "rosalia": "Rosália",
    "campos novos paulista": "Campos Novos Paulista",
    # apelidos e erros de digitação vistos na planilha
    "marilila": "Marília", "ppa": "Pompeia", "p nobrega": "Padre Nóbrega", "occ": "Ocauçu",
}


def cidade(v) -> str | None:
    s = texto(v)
    if not s:
        return None
    chave = _sem_acento(s).lower().strip(" .")
    chave = re.sub(r"\s*[-/]\s*sp$", "", chave)          # "Marilia-SP", "Marília/SP"
    chave = re.sub(r"[^a-z ]+", " ", chave).strip()          # "P.Nobrega" -> "p nobrega"
    chave = re.sub(r"\s+", " ", chave)
    if chave in CIDADES:
        return CIDADES[chave]
    return " ".join(p if p.lower() in ("de", "da", "do", "dos", "das") else p.capitalize() for p in s.lower().split())


def mac(v) -> tuple[str | None, bool]:
    """Devolve (mac_padronizado, ok). Aceita 24:FD:.., 24.FD.., 24-fd-.., 24FD0D..."""
    s = texto(v)
    if not s:
        return None, True
    hexa = re.sub(r"[^0-9A-Fa-f]", "", s)
    if len(hexa) != 12:
        return s, False
    hexa = hexa.upper()
    return ":".join(hexa[i:i + 2] for i in range(0, 12, 2)), True


def ip(v) -> tuple[str | None, bool]:
    s = texto(v)
    if not s:
        return None, True
    s = s.replace(" ", "")
    s = re.sub(r"^https?://", "", s).rstrip("/")
    so_ip = s.split(":")[0]
    try:
        ipaddress.ip_address(so_ip)
        return so_ip, True
    except ValueError:
        # "192168102179" e afins — guarda como veio para alguém corrigir
        return s, False


def inteiro(v) -> int | None:
    s = texto(v)
    if not s:
        return None
    m = re.match(r"^\d+", s)
    return int(m.group()) if m else None


def status_canal(v) -> str:
    """STATUS CANAL da planilha = ocupação do canal (indisponível = ocupado)."""
    s = (texto(v) or "").lower()
    s = _sem_acento(s)
    if s.startswith("indisp"):
        return "indisponivel"
    if s.startswith("dis"):  # inclui o erro "disnponível"
        return "disponivel"
    return "desconhecido"


def compressao(v) -> tuple[str | None, bool]:
    s = texto(v)
    if not s:
        return None, True
    t = s.upper().replace(".", "").replace(" ", "")
    if t in ("H264", "H264H", "H264B", "H264M"):
        return "H.264", True
    if t in ("H265", "H265H"):
        return "H.265", True
    if t in ("MJPEG", "MJPG"):
        return "MJPEG", True
    return None, False  # valor estranho (ex.: senha anotada na coluna errada)


def contratos(v) -> list[str]:
    """'94145 / 92366' -> ['94145', '92366']"""
    s = texto(v)
    if not s:
        return []
    return [p for p in re.split(r"[^0-9]+", s) if p]


def parece_endereco(v) -> bool:
    s = (texto(v) or "").upper()
    return bool(re.match(r"^(R\.|RUA |AV\.? |AVENIDA |AL\.? |ROD\.? |PRA[CÇ]A )", s)) or ("," in s and any(ch.isdigit() for ch in s))
