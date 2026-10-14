"""Importa câmeras LifeGuard de uma planilha colada em texto (TSV/CSV).

Uso (dentro de backend/, com o venv ativo):
    python -m app.ferramentas.importar_lifeguard /caminho/cameras.tsv            # só mostra o que faria
    python -m app.ferramentas.importar_lifeguard /caminho/cameras.tsv --aplicar  # grava

O arquivo é a planilha copiada do Excel e colada num .txt/.tsv (separado
por TAB) — também aceita CSV com ; ou ,. A primeira linha são os títulos:

  Cliente | Contrato | ID Cliente | Cidade | PPPOE | IP PPPOE | Nome | Local |
  IP CAMERA | PORTA TCP INTERNA (CAM) | PORTA LifeGUARD | ID LIFEGUARD |
  PORTA EXTERNA ... RTSP | LOGIN ONU BRIDGE | IP LOGIN BRIDGE

As três últimas vão para Observações. A câmera é identificada pelo ID
LIFEGUARD: se já existe, os dados são ATUALIZADOS (a foto não é tocada);
se não existe, é criada. Nada é apagado. Pode rodar de novo sem duplicar.

O arquivo tem dados de clientes — NÃO coloque no repositório.
"""
import argparse
import csv
import sys
import unicodedata
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from app.db.session import SessionLocal  # noqa: E402
from app.ferramentas import models  # noqa: E402,F401  (registra as tabelas)
from app.ferramentas import normalizar as nz  # noqa: E402
from app.ferramentas.models import FtCamera  # noqa: E402

# título normalizado (contém) -> campo. A ordem importa: o mais específico primeiro.
REGRAS = [
    ("ip pppoe", "ip_pppoe"),
    ("pppoe", "pppoe"),
    ("id cliente", "id_cliente_ixc"),
    ("id lifeguard", "lg_id"),
    ("porta lifeguard", "porta_lifeguard"),
    ("porta tcp", "porta"),
    ("porta externa", "obs_rtsp"),
    ("ip camera", "ip"),
    ("ip logoin", "obs_ip_bridge"),
    ("ip login", "obs_ip_bridge"),
    ("login onu", "obs_login_bridge"),
    ("contrato", "contrato_ixc"),
    ("cliente", "nome_cliente"),
    ("cidade", "cidade"),
    ("nome", "nome"),
    ("local", "descricao_local"),
]
CAMPOS = ["nome_cliente", "contrato_ixc", "id_cliente_ixc", "cidade", "pppoe", "ip_pppoe",
          "nome", "descricao_local", "ip", "porta", "porta_lifeguard"]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return " ".join(s.replace("(", " ").replace(")", " ").replace("-", " ").split())


def _mapear(cabecalho):
    mapa = {}
    for i, h in enumerate(cabecalho):
        n = _norm(h)
        for chave, campo in REGRAS:
            if chave in n and campo not in mapa.values():
                mapa[i] = campo
                break
    return mapa


def ler(caminho: Path):
    texto = caminho.read_text(encoding="utf-8-sig", errors="replace")
    primeira = texto.splitlines()[0] if texto.strip() else ""
    sep = "\t" if "\t" in primeira else (";" if primeira.count(";") >= primeira.count(",") else ",")
    linhas = list(csv.reader(texto.splitlines(), delimiter=sep))
    if not linhas:
        return [], {}
    mapa = _mapear(linhas[0])
    saida = []
    for n, linha in enumerate(linhas[1:], start=2):
        if not any(c.strip() for c in linha):
            continue
        d = {campo: (linha[i].strip() if i < len(linha) else "") for i, campo in mapa.items()}
        d["_linha"] = n
        saida.append(d)
    return saida, mapa


def montar(d: dict) -> tuple[dict, list[str]]:
    avisos = []
    dados = {k: nz.texto(d.get(k)) for k in CAMPOS}
    dados["cidade"] = nz.cidade(dados["cidade"])
    for k in ("ip", "ip_pppoe"):
        if dados[k]:
            v, ok = nz.ip(dados[k])
            if ok:
                dados[k] = v
            else:
                avisos.append(f"{k} inválido: {dados[k]}")
    obs = []
    if d.get("obs_rtsp"):
        obs.append(f"Porta externa RTSP (acesso cliente): {d['obs_rtsp'].strip()}")
    if d.get("obs_login_bridge"):
        obs.append(f"Login ONU bridge: {d['obs_login_bridge'].strip()}")
    if d.get("obs_ip_bridge"):
        obs.append(f"IP login bridge: {d['obs_ip_bridge'].strip()}")
    dados["observacoes"] = "\n".join(obs) or None
    return dados, avisos


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("arquivo")
    ap.add_argument("--aplicar", action="store_true", help="grava no banco (sem isto, só simula)")
    args = ap.parse_args(argv)

    registros, mapa = ler(Path(args.arquivo))
    faltando = [c for c in ("lg_id", "nome") if c not in mapa.values()]
    print("Colunas reconhecidas:", ", ".join(sorted(set(mapa.values()))))
    if faltando:
        print("ERRO: não achei a(s) coluna(s):", ", ".join(faltando))
        return 1

    db = SessionLocal()
    try:
        novas, atualizadas, puladas = 0, 0, 0
        vistos = set()
        for d in registros:
            lg = (d.get("lg_id") or "").strip()
            if not lg:
                puladas += 1
                print(f"  linha {d['_linha']}: sem ID LIFEGUARD — pulada")
                continue
            if lg in vistos:
                puladas += 1
                print(f"  linha {d['_linha']}: ID LIFEGUARD {lg} repetido no arquivo — pulada")
                continue
            vistos.add(lg)
            dados, avisos = montar(d)
            for a in avisos:
                print(f"  linha {d['_linha']} (LG {lg}): {a}")
            cam = db.query(FtCamera).filter(FtCamera.lg_id == lg).first()
            if cam is None:
                cam = FtCamera(tipo="lifeguard", lg_id=lg, status="desconhecido", origem_importacao="importar_lifeguard")
                for k, v in dados.items():
                    setattr(cam, k, v)
                cam.nome = cam.nome or f"LG {lg}"
                db.add(cam)
                novas += 1
            else:
                if cam.tipo != "lifeguard":
                    puladas += 1
                    print(f"  linha {d['_linha']}: ID {lg} pertence a uma câmera de NVR — pulada")
                    continue
                for k, v in dados.items():
                    if k == "observacoes":
                        if v and v not in (cam.observacoes or ""):
                            cam.observacoes = f"{cam.observacoes}\n{v}" if cam.observacoes else v
                    elif v:  # só sobrescreve com valor preenchido
                        setattr(cam, k, v)
                atualizadas += 1
        print(f"\nNovas: {novas} · atualizadas: {atualizadas} · puladas: {puladas}")
        if args.aplicar:
            db.commit()
            print("GRAVADO.")
        else:
            db.rollback()
            print("SIMULAÇÃO — nada foi gravado. Rode de novo com --aplicar.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
