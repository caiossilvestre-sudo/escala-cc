# Passagem de plantão + lembretes pelo Teams

Descompacte por cima da pasta do projeto `escala-cc` (mesmos caminhos), depois
GitHub Desktop → commit → push. No servidor:

    cd /opt/escala_app
    git status            # arquivo modificado no servidor? git checkout -- <arquivo>
    git pull
    cd frontend && npm run build && cd ..
    sudo systemctl restart escala

- Nginx: nada a fazer (rotas em /ferramentas/passagem, prefixo já liberado)
- Banco: nada a fazer (tabelas ft_passagens / ft_pendencias criadas no start)
- pip: nada novo

## .env do backend (opcional)
    PASSAGEM_LINK=https://suporte-tecnico.silvertec.net.br   # link nas mensagens do Teams
    PASSAGEM_LEMBRETE_MIN=30                                 # antecedência do "registre a passagem"
    # PASSAGEM_LEMBRETES=0                                   # desliga os lembretes
    # PASSAGEM_EMAIL_PARA=voce@empresa.com.br                # e-mail a cada passagem

## Liberar acesso
Ferramentas › LifeGuard › Documentação › Permissões:
plantonistas = "Plantonista" (Registrar / baixar) · gestor = "Gestor".
Os lembretes do Teams vão para quem tem Registrar e NÃO é Gestor,
conforme o horário/ciclo 12x36 do cadastro do colaborador.

## Power Automate
Se o fluxo filtra pelo campo "tipo", inclua: passagem_registrar, passagem_entrada.
