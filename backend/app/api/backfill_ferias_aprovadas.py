# -*- coding: utf-8 -*-
"""
Gera o aviso "ferias_aprovada" retroativo pra toda solicitação de férias que
já está com status 'aprovada' no banco (aprovada ANTES da correção que criou
o aviso automático). Aparece no painel do colaborador e no histórico de
Avisos, mas fica marcado como já enviado pro Teams e sem tentar reenviar
e-mail — pra não ficar mandando mensagem de férias antiga pro Teams agora.

Roda uma vez só. Se rodar de novo sem querer, não duplica (pula quem já tem
o aviso pra aquele período).

    cd /opt/escala_app/backend
    source venv/bin/activate
    python3 backfill_ferias_aprovadas.py
    deactivate
"""
from datetime import timedelta

from app.db.session import SessionLocal
from app.db.models import Aviso, Colaborador, Ferias


def main():
    db = SessionLocal()
    criados = []
    pulados = []
    try:
        aprovadas = db.query(Ferias).filter(Ferias.status == "aprovada").all()
        for f in aprovadas:
            ja_existe = (
                db.query(Aviso)
                .filter(
                    Aviso.colaborador_id == f.colaborador_id,
                    Aviso.tipo == "ferias_aprovada",
                    Aviso.mensagem.contains(f.data_inicio.strftime("%d/%m/%Y")),
                )
                .first()
            )
            colaborador = db.get(Colaborador, f.colaborador_id)
            if not colaborador:
                continue
            if ja_existe:
                pulados.append(colaborador.nome)
                continue

            retorno = f.data_fim + timedelta(days=1)
            mensagem = (
                f"Suas férias de {f.data_inicio.strftime('%d/%m/%Y')} a {f.data_fim.strftime('%d/%m/%Y')} "
                f"foram aprovadas! Retorno ao trabalho em {retorno.strftime('%d/%m/%Y')}."
            )
            if f.nota_admin:
                mensagem += f"\nObservação: {f.nota_admin}"

            data_aviso = (f.updated_at or f.created_at).date()
            aviso = Aviso(
                colaborador_id=f.colaborador_id,
                tipo="ferias_aprovada",
                data=data_aviso,
                canais=["painel"],
                mensagem=mensagem,
                teams_enviado=True,  # já passou, não manda retroativo pro Teams
            )
            db.add(aviso)
            criados.append(f"{colaborador.nome} ({f.data_inicio.strftime('%d/%m/%Y')} a {f.data_fim.strftime('%d/%m/%Y')})")
        db.commit()
    finally:
        db.close()

    print(f"\n{len(criados)} aviso(s) retroativo(s) criado(s):")
    for c in criados:
        print(f"  - {c}")

    if pulados:
        print(f"\n{len(pulados)} já tinham aviso (pulado, sem duplicar):")
        for p in pulados:
            print(f"  - {p}")


if __name__ == "__main__":
    main()
