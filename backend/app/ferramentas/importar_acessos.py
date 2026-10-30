"""Importa seções, links e senhas para "Acessos do setor" a partir de um JSON.

Uso (dentro de backend/, com o venv ativo e o .env carregado):
    python -m app.ferramentas.importar_acessos /caminho/acessos.json email@dono            # só mostra
    python -m app.ferramentas.importar_acessos /caminho/acessos.json email@dono --aplicar  # grava

"email@dono" é o colaborador que fica como autor do que for importado
(normalmente o admin). As senhas são gravadas CIFRADAS com a mesma chave
FERRAMENTAS_CHAVE_CRIPTO das senhas dos gravadores.

Formato:
  {"secoes": [
     {"nome": "Suporte geral", "tipo": "links",
      "itens": [{"nome": "IXC", "link": "https://...", "descricao": "...",
                 "credenciais": [{"usuario": "x", "senha": "y", "rotulo": "N2"}]}]},
     {"nome": "Equipamentos · senhas padrão", "tipo": "equipamentos", "itens": [...]}
  ]}

Pode rodar de novo: seção existente (mesmo nome) é reaproveitada, item
existente (mesmo nome na seção) é pulado com tudo o que tem dentro.

O arquivo tem senhas em texto aberto — NÃO coloque no repositório e apague
depois de importar.
"""
import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # antes de importar o app (DATABASE_URL, FERRAMENTAS_CHAVE_CRIPTO)

from sqlalchemy import func  # noqa: E402

import app.db.models  # noqa: E402,F401
from app.db.models import Colaborador  # noqa: E402
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.ferramentas.models import FtAcessoCred, FtAcessoItem, FtAcessoSecao  # noqa: E402
from app.ferramentas.seguranca import cifrar  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("arquivo")
    ap.add_argument("email_autor")
    ap.add_argument("--aplicar", action="store_true", help="grava no banco (sem isso, só mostra)")
    a = ap.parse_args()

    dados = json.loads(Path(a.arquivo).read_text(encoding="utf-8"))
    Base.metadata.create_all(bind=engine)  # cria as tabelas novas se o backend ainda não subiu
    db = SessionLocal()
    autor = db.query(Colaborador).filter(func.lower(Colaborador.email) == a.email_autor.lower()).first()
    if not autor:
        print(f"Colaborador {a.email_autor} não encontrado.")
        return 1

    n_sec = n_item = n_cred = pulados = 0
    ordem_sec = db.query(func.max(FtAcessoSecao.ordem)).scalar() or 0
    for s in dados.get("secoes", []):
        nome = s["nome"].strip()
        sec = next((x for x in db.query(FtAcessoSecao).all() if x.nome.lower() == nome.lower()), None)
        if not sec:
            ordem_sec += 1
            sec = FtAcessoSecao(nome=nome, tipo=s.get("tipo", "links"), ordem=ordem_sec)
            db.add(sec)
            db.flush()
            n_sec += 1
        print(f"\n[{sec.nome}]")
        ordem_item = db.query(func.max(FtAcessoItem.ordem)).filter(FtAcessoItem.secao_id == sec.id).scalar() or 0
        for it in s.get("itens", []):
            existe = next((x for x in db.query(FtAcessoItem).filter(FtAcessoItem.secao_id == sec.id,
                                                                     FtAcessoItem.excluido_em.is_(None)).all()
                           if x.nome.lower() == it["nome"].strip().lower()), None)
            if existe:
                pulados += 1
                print(f"  = {it['nome']} (já existe, pulado)")
                continue
            ordem_item += 1
            item = FtAcessoItem(secao_id=sec.id, nome=it["nome"].strip(), link=(it.get("link") or None),
                                descricao=(it.get("descricao") or None), ordem=ordem_item,
                                criado_por_id=autor.id, atualizado_por_id=autor.id)
            db.add(item)
            db.flush()
            n_item += 1
            creds = it.get("credenciais", [])
            for k, c in enumerate(creds, start=1):
                db.add(FtAcessoCred(item_id=item.id, usuario=(c.get("usuario") or None),
                                    senha_cifrada=cifrar(c.get("senha")), rotulo=(c.get("rotulo") or None),
                                    ordem=k, criado_por_id=autor.id, atualizado_por_id=autor.id))
            n_cred += len(creds)
            print(f"  + {item.nome}" + (f"  ({len(creds)} acesso(s))" if creds else ""))

    print(f"\nSeções novas: {n_sec} · itens novos: {n_item} · acessos: {n_cred} · itens já existentes: {pulados}")
    if a.aplicar:
        db.commit()
        print("Gravado. Apague o arquivo JSON agora.")
    else:
        db.rollback()
        print("Nada gravado (simulação). Rode de novo com --aplicar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
