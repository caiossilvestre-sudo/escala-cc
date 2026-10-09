"""Colunas novas do módulo em tabelas que JÁ existem no banco.

O create_all do Escala só cria tabelas que não existem; coluna nova em
tabela existente precisa de ALTER TABLE. Aqui só se ACRESCENTA coluna
(ADD COLUMN IF NOT EXISTS): nada é apagado, renomeado ou recriado, e os
dados atuais (câmeras, senhas, fotos) não são tocados. Roda toda vez que
o backend sobe; se a coluna já existe, não faz nada.
"""
from sqlalchemy import inspect, text

from app.db.session import engine

COLUNAS_NOVAS = {
    "ft_gravadores": [
        ("ativo", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("total_canais", "INTEGER"),
        ("marca", "VARCHAR"),
        ("url_https", "VARCHAR"),
        ("porta_rtsp", "VARCHAR"),
    ],
}


def aplicar():
    try:
        tabelas = set(inspect(engine).get_table_names())
    except Exception as e:  # banco fora do ar: o resto do Escala reporta
        print(f"[ferramentas] migração adiada: {e}")
        return
    postgres = engine.dialect.name == "postgresql"
    for tabela, colunas in COLUNAS_NOVAS.items():
        if tabela not in tabelas:
            continue  # banco novo: o create_all cria a tabela já completa
        existentes = {c["name"] for c in inspect(engine).get_columns(tabela)}
        for nome, tipo in colunas:
            if nome in existentes:
                continue
            sql = f"ALTER TABLE {tabela} ADD COLUMN {'IF NOT EXISTS ' if postgres else ''}{nome} {tipo}"
            try:
                with engine.begin() as conn:  # uma transação por coluna
                    conn.execute(text(sql))
                print(f"[ferramentas] coluna nova: {tabela}.{nome}")
            except Exception as e:
                print(f"[ferramentas] aviso ao criar {tabela}.{nome}: {e}")
