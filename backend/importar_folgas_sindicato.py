# -*- coding: utf-8 -*-
"""
Lança as folgas do sindicato de 2026 (1ª, 2ª e 3ª) a partir da planilha do Caio.

Rodar de dentro de /opt/escala_app/backend, com o venv ativado:

    cd /opt/escala_app/backend
    source venv/bin/activate
    python3 importar_folgas_sindicato.py            # SIMULA: mostra o que faria, não grava nada
    python3 importar_folgas_sindicato.py --aplicar  # grava
    deactivate

- Cada data vira uma solicitação "folga_sindicato" já APROVADA (igual a quando o
  admin registra a folga em nome de alguém pela tela).
- Pode rodar de novo: se a pessoa já tem folga sindicato nessa mesma data, pula.
- "Pago", célula vazia, "junho" (sem dia) e "Agendar até..." NÃO são lançados.
- O colaborador é encontrado pelo nome (só ativos). Quem não for encontrado ou
  tiver mais de um nome parecido aparece no relatório e fica de fora.
- No final mostra, por pessoa, qual janela (Maio/Agosto/Outubro/Dezembro) cada
  data ocupou pela regra do sistema, e avisa quando duas datas caíram na mesma
  janela (aí uma delas não conta como cota separada).
"""
import argparse
import re
import unicodedata
from datetime import UTC, date, datetime

from app.db.session import SessionLocal
from app.db.models import Colaborador, SolicitacaoFolga
from app.logic import resumo_cotas_sindicato

ANO = 2026
MESES = {"jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6, "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12}

# (setor na planilha, nome, 1ª, 2ª, 3ª) — copiado da planilha enviada em 13/11/2026
DADOS = [
    ("Atendimento N2", "Arthur Vinicius R. C. Rossi", "08/mai", "29/ago", "02/out"),
    ("Atendimento N2", "Hugo Nogueira Januario", "30/mai", "01/ago", "10/out"),
    ("Atendimento N2", "Marcelo Miranda Junior", "08/jul", "24/ago", "26/set"),
    ("Atendimento N2", "Francisco de Souza Sancho", "13/mai", "04/set", ""),
    ("Atendimento N2", "Guilherme Turibio Rodrigues", "22/jun", "15/ago", "26/out"),
    ("Atendimento N2", "Mayara Marry Martinez Perin", "09/mai", "08/set", ""),
    ("Atendimento N2", "Nicolas Florencio Alves", "15/mai", "26/set", ""),
    ("Atendimento N2", "Davi Biko dos Santos Batista", "11/jul", "21/nov", ""),
    ("Atendimento N2", "Emanuel de Araujo Oliveira", "27/mai", "31/out", ""),

    ("Monitoramento", "Eduardo Marques Luiz", "12/jun", "26/set", "21/nov"),
    ("Monitoramento", "Renato Locatel Lesia de Assis", "19/set", "Pago", "14/nov"),
    ("Monitoramento", "Fabiano Angenendt da Silva", "25/jul", "08/ago", "17/out"),
    ("Monitoramento", "Marcus Vinicius P M", "Pago", "19/nov", ""),

    ("Atendimento N1", "Pedro Augusto dos S. Gouveia", "19/jun", "10/set", "26/out"),
    ("Atendimento N1", "Luan Thomazini M. de Oliveira", "17/jul", "11/set", "31/out"),
    ("Atendimento N1", "Carlos Eduardo M. D. Lopes", "15/ago", "17/out", ""),
    ("Atendimento N1", "Estevão Graciliano de Carvalho", "31/ago", "28/set", "21/nov"),
    ("Atendimento N1", "Janaina de Lima Finotti", "23/mai", "22/out", ""),
    ("Atendimento N1", "João Vitor Soares de Almeida", "31/ago", "16/out", ""),
    ("Atendimento N1", "Kelvin Rodrigues dos Santos", "18/ago", "14/set", "12/nov"),
    ("Atendimento N1", "Luiz Otávio Farinha de Araújo", "", "24/set", "12/nov"),
    ("Atendimento N1", "Fernanda Batista da Silva", "Pago", "18/set", ""),
    ("Atendimento N1", "Luca de Cerqueira C. Yarmak", "22/ago", "02/out", ""),
    ("Atendimento N1", "Maria", "19/nov", "23/nov", ""),
    ("Atendimento N1", "Gustavo", "", "14/nov", ""),
    ("Atendimento N1", "Thiago", "", "22/out", ""),
    ("Atendimento N1", "Gabriel", "", "09/nov", ""),
    ("Atendimento N1", "Beatriz", "26/nov", "", ""),
    ("Atendimento N1", "Flavio", "12/jun", "", ""),

    ("Presencial", "Ketlyn Walace Vargas Balero", "04/mai", "05/jun", "18/set"),
    ("Presencial", "Carolina dos Santos Tomizi", "16/mai", "16/out", ""),
    ("Presencial", "Natalia da Silva Pereira", "junho", "29/set", ""),
    ("Presencial", "Lorena de Carvalho Lima", "20/jun", "08/set", ""),
    ("Presencial", "Stephanie Natacha S. Bertarelli", "20/jul", "30/out", ""),
]


def norm(txt: str) -> list[str]:
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode().lower()
    return [t for t in re.split(r"[^a-z]+", txt) if t]


def parse_data(celula: str):
    """'08/mai' -> date(2026, 5, 8). Qualquer outra coisa -> None."""
    m = re.fullmatch(r"\s*(\d{1,2})\s*/\s*([a-zA-Zç]{3})\w*\s*", celula or "")
    if not m or m.group(2).lower()[:3] not in MESES:
        return None
    return date(ANO, MESES[m.group(2).lower()[:3]], int(m.group(1)))


def achar(nome: str, ativos: list[Colaborador]):
    """Primeiro nome igual + todo pedaço com 2+ letras do nome da planilha
    precisa estar no nome do sistema (abreviações como 'R.' ou 'P' são ignoradas)."""
    partes = norm(nome)
    primeiro, resto = partes[0], [p for p in partes[1:] if len(p) >= 2 and p not in ("de", "da", "do", "dos", "das")]
    achados = []
    for c in ativos:
        n = norm(c.nome)
        if n and n[0] == primeiro and all(r in n for r in resto):
            achados.append(c)
    return achados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="grava no banco (sem isso, só simula)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        ativos = db.query(Colaborador).filter(Colaborador.status == "ativo").all()
        admin = (db.query(Colaborador).filter(Colaborador.role == "admin", Colaborador.status == "ativo")
                 .order_by(Colaborador.nome).first())
        agora = datetime.now(UTC).replace(tzinfo=None)

        criadas, puladas, nao_achados, ambiguos, nao_lancado = [], [], [], [], []
        tocados = {}
        for setor, nome, *celulas in DADOS:
            achados = achar(nome, ativos)
            if not achados:
                nao_achados.append(f"{nome} ({setor})")
                continue
            if len(achados) > 1:
                ambiguos.append(f"{nome} ({setor}) -> " + ", ".join(f"{c.nome} [{c.equipe}]" for c in achados))
                continue
            colab = achados[0]
            tocados[colab.id] = (colab, nome, celulas)
            for ordem, celula in enumerate(celulas, start=1):
                d = parse_data(celula)
                if d is None:
                    if celula.strip():
                        nao_lancado.append(f"{colab.nome}: {ordem}ª = '{celula}'")
                    continue
                existe = (db.query(SolicitacaoFolga)
                          .filter(SolicitacaoFolga.colaborador_id == colab.id,
                                  SolicitacaoFolga.tipo == "folga_sindicato",
                                  SolicitacaoFolga.data_solicitada == d,
                                  SolicitacaoFolga.status != "rejeitada").first())
                if existe:
                    puladas.append(f"{colab.nome}: {d:%d/%m} já existe ({existe.status})")
                    continue
                db.add(SolicitacaoFolga(
                    colaborador_id=colab.id, tipo="folga_sindicato", data_solicitada=d,
                    status="aprovada", resolved_by=admin.id if admin else None, resolved_at=agora))
                criadas.append(f"{colab.nome}: {ordem}ª em {d:%d/%m/%Y}")
        db.flush()  # deixa as novas visíveis para o cálculo das janelas abaixo

        print(f"\n=== {'GRAVANDO' if args.aplicar else 'SIMULAÇÃO (nada será gravado)'} ===\n")
        print(f"Folgas a lançar: {len(criadas)}")
        for x in criadas: print("  +", x)
        if puladas:
            print(f"\nJá estavam no sistema (puladas): {len(puladas)}")
            for x in puladas: print("  =", x)
        if nao_lancado:
            print("\nNão lançadas (Pago / sem dia):")
            for x in nao_lancado: print("  -", x)
        if nao_achados:
            print("\nNão encontrados entre os colaboradores ativos:")
            for x in nao_achados: print("  ?", x)
        if ambiguos:
            print("\nMais de um colaborador com nome parecido (não lançado — me avise qual é):")
            for x in ambiguos: print("  ?", x)

        print("\nComo o sistema distribui nas janelas do ciclo", ANO, "(todas as folgas sindicato da pessoa):")
        alertas = 0
        for colab, nome, celulas in tocados.values():
            todas = (db.query(SolicitacaoFolga)
                     .filter(SolicitacaoFolga.colaborador_id == colab.id, SolicitacaoFolga.tipo == "folga_sindicato",
                             SolicitacaoFolga.status != "rejeitada", SolicitacaoFolga.data_solicitada >= date(ANO, 5, 1),
                             SolicitacaoFolga.data_solicitada <= date(ANO + 1, 2, 28)).all())
            resumo = resumo_cotas_sindicato(db, colab.id, ANO)
            por_id = {s.id: s for s in todas}
            usadas = {c["nome"]: por_id[c["solicitacao_id"]].data_solicitada for c in resumo["cotas"] if c["usada"] and c["solicitacao_id"] in por_id}
            linha = "  ".join(f"{k} {v:%d/%m}" for k, v in usadas.items())
            sobra = [s.data_solicitada for s in todas if s.id not in {c["solicitacao_id"] for c in resumo["cotas"]}]
            aviso = ""
            if sobra:
                alertas += 1
                aviso = f"   <-- {len(todas)} datas, só {len(usadas)} janelas contadas (duas caíram na mesma janela)"
            print(f"  {colab.nome[:34]:34} {linha}{aviso}")
        if alertas:
            print(f"\n{alertas} pessoa(s) com data em janela já ocupada: pela regra do sistema (Maio 01/05–31/08, "
                  "Agosto 01/08–31/10, Outubro 01/10–30/11, Dezembro 01/12–28/02) essas datas não contam como cota separada.")

        if args.aplicar:
            db.commit()
            print("\nGravado.")
        else:
            db.rollback()
            print("\nNada foi gravado. Se estiver tudo certo, rode de novo com --aplicar")
    finally:
        db.close()


if __name__ == "__main__":
    main()
