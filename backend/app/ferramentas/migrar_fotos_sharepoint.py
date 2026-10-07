"""Move para o SharePoint as fotos que ainda estão no disco do servidor.

Uso (dentro de backend/, com o venv ativo e o SharePoint já testado):
    python -m app.ferramentas.migrar_fotos_sharepoint            # só mostra o que faria
    python -m app.ferramentas.migrar_fotos_sharepoint --aplicar  # move de verdade

Para cada câmera com foto no disco: envia para o SharePoint, atualiza o
banco e só então apaga o arquivo local. Pode rodar de novo: o que já está
no SharePoint é pulado.
"""
import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from app.db.session import SessionLocal  # noqa: E402
from app.ferramentas import fotos, sharepoint  # noqa: E402
from app.ferramentas.models import FtCamera  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="move de verdade (sem isto, só simula)")
    args = ap.parse_args(argv)

    db = SessionLocal()
    try:
        cams = (db.query(FtCamera)
                .filter(FtCamera.foto_arquivo.isnot(None), ~FtCamera.foto_arquivo.like(f"{fotos.PREFIXO_SP}%"))
                .all())
        print(f"Fotos no disco para mover: {len(cams)}")
        if not args.aplicar:
            print("SIMULAÇÃO — nada foi movido. Rode com --aplicar.")
            return 0
        movidas, faltando, erros = 0, 0, 0
        for cam in cams:
            local = fotos.pasta_fotos() / Path(cam.foto_arquivo).name
            if not local.exists():
                faltando += 1
                print(f"  arquivo sumiu do disco: {cam.nome} ({cam.foto_arquivo}) — foto removida do cadastro")
                cam.foto_arquivo = None
                db.commit()
                continue
            nome = local.name
            try:
                sharepoint.enviar(nome, local.read_bytes())
            except sharepoint.ErroSharePoint as e:
                erros += 1
                print(f"  ERRO em {cam.nome}: {e}")
                continue
            cam.foto_arquivo = fotos.PREFIXO_SP + nome
            db.commit()
            local.unlink(missing_ok=True)
            movidas += 1
            if movidas % 50 == 0:
                print(f"  {movidas} movidas…")
        print(f"\nMovidas: {movidas} · sem arquivo no disco: {faltando} · erros: {erros}")
        return 1 if erros else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
