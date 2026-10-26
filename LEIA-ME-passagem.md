# Passagem de plantão — Ferramentas › Plantão

Arquivos no mesmo caminho do repositório `escala-cc` (descompacte por cima da pasta do projeto).

## Deploy
1. GitHub Desktop → commit → push
2. No servidor: `git pull` → `cd frontend && npm run build` → `sudo systemctl restart escala`
3. **Nginx: nada a fazer** — as rotas novas ficam em `/ferramentas/passagem/...`, prefixo já liberado.
4. **Banco: nada a fazer** — as tabelas novas (`ft_passagens`, `ft_pendencias`) são criadas sozinhas no start. Nenhuma tabela existente é alterada.

## Liberar para a equipe
Ferramentas › LifeGuard › Documentação › Permissões (admin):
- Plantonistas: botão **Plantonista** (ou a caixinha "Registrar / baixar")
- Gestor/supervisor: caixinha **Gestor** (já inclui registrar)
Admin do sistema já tem tudo.

## E-mail a cada passagem (opcional)
No `.env` do backend: `PASSAGEM_EMAIL_PARA=voce@empresa.com.br,outro@empresa.com.br`
(usa o SMTP que o sistema já tem). Reinicie o serviço.

## Arquivos
Novos: backend/app/ferramentas/routes_passagem.py, frontend/src/ferramentas/Passagem*.jsx, passagemUtil.jsx
Alterados: ferramentas/models.py, schemas.py, seguranca.py, routes.py (2 linhas no fim), __init__.py (comentário),
paginas.js, MenuFerramentas.jsx, Permissoes.jsx, ferramentas.css, App.jsx (1 linha: aceita abas "ft-"), backend/.env.example
