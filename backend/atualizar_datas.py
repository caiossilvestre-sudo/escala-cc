# -*- coding: utf-8 -*-
"""
Atualiza data_aniversario e data_admissao dos colaboradores, casando pelo e-mail.
Rodar de dentro de /opt/escala_app/backend, com o venv ativado:

    cd /opt/escala_app/backend
    source venv/bin/activate
    python3 atualizar_datas.py
    deactivate

Não altera nenhum outro campo. Colaboradores cujo e-mail não for encontrado
no banco são só reportados no final (nada quebra).
"""
from datetime import datetime

from app.db.session import SessionLocal
from app.db.models import Colaborador

# (email, data_nascimento "DD/MM/AAAA", data_admissao "DD/MM/AAAA")
DADOS = [
    ("arthur.rossi@life.net.br", "08/05/2007", "04/11/2025"),
    ("beatriz.araujo@life.net.br", "02/05/2008", "23/02/2026"),
    ("caiosilvestre@life.net.br", "15/02/1993", "23/02/2012"),
    ("carlos.lopes@life.net.br", "10/01/2005", "02/02/2026"),
    ("caroline.tomizi@life.net.br", "21/04/2000", "28/04/2025"),
    ("davi.batista@life.net.br", "02/07/2004", "24/03/2025"),
    ("eduardo.luiz@life.net.br", "30/09/1990", "22/11/2022"),
    ("emanuel.oliveira@life.net.br", "23/09/2001", "26/02/2025"),
    ("erica.silva@life.net.br", "18/04/1999", "19/06/2018"),
    ("estevao.carvalho@life.net.br", "18/12/2004", "16/02/2026"),
    ("fabiano.silva@life.net.br", "03/05/2000", "10/11/2025"),
    ("fernando.vieira@life.net.br", "07/09/1985", "05/11/2018"),
    ("flavio.lopes@life.net.br", "08/04/2005", "10/11/2025"),
    ("francisco.sancho@life.net.br", "23/11/1985", "14/08/2024"),
    ("george.barros@life.net.br", "15/12/1981", "19/02/2024"),
    ("guilherme.rodrigues@life.net.br", "23/06/1999", "27/02/2023"),
    ("gustavo.miranda@life.net.br", "05/02/2001", "14/09/2026"),
    ("hugo.januario@life.net.br", "14/07/1997", "07/07/2025"),
    ("janaina.finotti@life.net.br", "22/10/1994", "03/08/2020"),
    ("joao.almeida@life.net.br", "29/08/2005", "07/01/2025"),
    ("karina.prado@life.net.br", "08/08/1997", "02/08/2021"),
    ("kelvin.santos@life.net.br", "11/12/2000", "28/04/2025"),
    ("ketlyn.balero@life.net.br", "26/01/2001", "11/12/2023"),
    ("lara.ribeiro@life.net.br", "13/03/1998", "18/11/2024"),
    ("luan.oliveira@life.net.br", "25/05/2006", "11/12/2025"),
    ("luca.yarmak@life.net.br", "20/08/2005", "11/12/2025"),
    ("luiz.araujo@life.net.br", "29/03/2006", "04/08/2026"),
    ("marcelo.junior@life.net.br", "13/06/1997", "23/04/2024"),
    ("marcus.moraes@life.net.br", "27/07/1994", "22/07/2024"),
    ("maria.almeida@life.net.br", "16/07/2002", "02/12/2019"),
    ("mayara.perin@life.net.br", "03/05/1992", "27/11/2019"),
    ("natalia.pereira@life.net.br", "30/07/2000", "04/01/2021"),
    ("nicolas.alves@life.net.br", "10/10/2003", "19/05/2025"),
    ("pedro.gouveia@life.net.br", "14/12/2004", "18/11/2024"),
    ("renatolocatel@life.net.br", "07/11/1997", "19/10/2017"),
    ("stefanie.gaspar@life.net.br", "24/05/1992", "23/06/2025"),
    ("stephanie.abreu@life.net.br", "18/11/1993", "05/06/2023"),
]


def parse(d):
    return datetime.strptime(d, "%d/%m/%Y").date()


def main():
    db = SessionLocal()
    atualizados = []
    nao_encontrados = []
    try:
        for email, nascimento, admissao in DADOS:
            colaborador = (
                db.query(Colaborador)
                .filter(Colaborador.email.ilike(email))
                .first()
            )
            if not colaborador:
                nao_encontrados.append(email)
                continue
            colaborador.data_aniversario = parse(nascimento)
            colaborador.data_admissao = parse(admissao)
            atualizados.append(f"{colaborador.nome} ({email})")
        db.commit()
    finally:
        db.close()

    print(f"\n{len(atualizados)} colaborador(es) atualizado(s):")
    for a in atualizados:
        print(f"  - {a}")

    if nao_encontrados:
        print(f"\n{len(nao_encontrados)} e-mail(s) NÃO encontrado(s) no banco (verifique se o login bate):")
        for e in nao_encontrados:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
