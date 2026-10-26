# Passagem de plantão (completo: lembretes Teams, prints, excluir pendência)

Descompacte por cima da pasta do projeto `escala-cc`, depois
GitHub Desktop → commit → push. No servidor:

    cd /opt/escala_app
    git pull
    cd frontend && npm run build && cd ..
    sudo systemctl restart escala

Nginx / pip / banco: nada a fazer.
.env (opcional): PASSAGEM_LINK=https://suporte-tecnico.silvertec.net.br
