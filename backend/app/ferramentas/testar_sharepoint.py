"""Confere se o servidor consegue usar a biblioteca do SharePoint.

Uso (dentro de backend/, com o venv ativo):
    python -m app.ferramentas.testar_sharepoint

Passo a passo: login do app no Entra ID, acha o site e a biblioteca, grava
um arquivo de teste em Fotos/, lê de volta e apaga. Não mexe em nenhuma foto.
"""
import sys

from dotenv import load_dotenv

load_dotenv()

from app.ferramentas import sharepoint as sp  # noqa: E402


def passo(titulo, funcao):
    print(f"- {titulo}… ", end="", flush=True)
    try:
        r = funcao()
        print("ok")
        return r
    except Exception as e:  # noqa: BLE001
        print(f"FALHOU\n    {e}")
        sys.exit(1)


def main():
    passo("login do app (client ID + secret)", sp._token)
    drive = passo("site e biblioteca", sp._drive_id)
    print(f"    biblioteca encontrada (id {drive[:12]}…)")
    conteudo = b"teste do Escala - pode apagar"
    passo("gravar Fotos/_teste_escala.txt", lambda: sp.enviar("_teste_escala.txt", conteudo, "text/plain"))
    lido = passo("ler o arquivo de volta", lambda: sp.baixar("_teste_escala.txt"))
    if lido != conteudo:
        print("    o conteúdo lido é diferente do gravado")
        sys.exit(1)
    passo("apagar o arquivo de teste", lambda: sp.apagar("_teste_escala.txt"))
    print("\nTudo certo. Pode colocar FERRAMENTAS_FOTOS_DESTINO=sharepoint no .env e reiniciar o serviço.")


if __name__ == "__main__":
    main()
