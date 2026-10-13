#!/usr/bin/env bash
# Cria o bloco do Nginx de um projeto num subdomínio de silvertec.net.br,
# usando o certificado wildcard (/etc/letsencrypt/live/silvertec/).
#
# Uso:   sudo bash deploy/novo-subdominio.sh <subdominio> <porta-do-projeto>
# Ex.:   sudo bash deploy/novo-subdominio.sh checkpoint 8005
#
# Antes: crie no Cloudflare um registro A  <subdominio> -> 201.62.68.131
#        (nuvem cinza / Somente DNS).
set -euo pipefail

DOMINIO="silvertec.net.br"
CERT_DIR="/etc/letsencrypt/live/silvertec"
SUB="${1:-}"
PORTA="${2:-}"

if [[ -z "$SUB" || -z "$PORTA" ]]; then
  echo "Uso: sudo bash $0 <subdominio> <porta>   (ex.: checkpoint 8005)"; exit 1
fi
if [[ ! "$SUB" =~ ^[a-z0-9-]+$ ]]; then
  echo "Subdomínio inválido (use só letras minúsculas, números e hífen)."; exit 1
fi
if [[ ! "$PORTA" =~ ^[0-9]+$ ]]; then
  echo "Porta inválida."; exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Rode com sudo."; exit 1
fi
if [[ ! -f "$CERT_DIR/fullchain.pem" ]]; then
  echo "Certificado wildcard não encontrado em $CERT_DIR."; exit 1
fi

FQDN="$SUB.$DOMINIO"
ARQ="/etc/nginx/sites-available/$SUB-silvertec.conf"
LINK="/etc/nginx/sites-enabled/$SUB-silvertec.conf"

if [[ -e "$ARQ" || -e "$LINK" ]]; then
  echo "Já existe configuração para $FQDN ($ARQ). Nada foi alterado."; exit 1
fi
if grep -rqs "server_name[^;]*[[:space:]]$FQDN[[:space:];]" /etc/nginx/sites-enabled/ 2>/dev/null; then
  echo "$FQDN já aparece em outro bloco do Nginx. Nada foi alterado."; exit 1
fi

cat > "$ARQ" <<CONF
server {
    listen 443 ssl;
    server_name $FQDN;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade_ou_close;
    }
}
CONF

# Mapa do WebSocket (criado uma única vez)
MAPA="/etc/nginx/conf.d/websocket-upgrade.conf"
if [[ ! -f "$MAPA" ]] && ! grep -rqs "connection_upgrade_ou_close" /etc/nginx/nginx.conf /etc/nginx/conf.d/ 2>/dev/null; then
  cat > "$MAPA" <<MAP
map \$http_upgrade \$connection_upgrade_ou_close {
    default upgrade;
    ''      close;
}
MAP
fi

ln -s "$ARQ" "$LINK"
if nginx -t; then
  systemctl reload nginx
  echo
  echo "Pronto: https://$FQDN  ->  127.0.0.1:$PORTA"
  echo "Lembre: registro A '$SUB' no Cloudflare -> 201.62.68.131 (nuvem cinza)."
else
  rm -f "$LINK" "$ARQ"
  echo "O teste do Nginx falhou. A configuração nova foi removida; nada mudou."
  exit 1
fi
