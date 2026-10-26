# Passagem de plantão + lembretes Teams + prints anexados

Descompacte por cima da pasta do projeto `escala-cc`, depois
GitHub Desktop → commit → push. No servidor:

    cd /opt/escala_app
    git pull
    cd frontend && npm run build && cd ..
    sudo systemctl restart escala

- Nginx / pip / banco: nada a fazer (tabela nova ft_anexos é criada no start)
- Prints ficam em FERRAMENTAS_FOTOS_DIR/passagem (mesma pasta das fotos da
  documentação — já entra no backup dela)

.env (opcional): PASSAGEM_LINK=https://suporte-tecnico.silvertec.net.br
