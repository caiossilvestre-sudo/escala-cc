# Escala CC — Sistema de Escala para Suporte Técnico

Versão real (backend + banco de dados + login) do protótipo que testamos no
Claude. Pronta pra ir pro GitHub como repositório **público** — o controle de
acesso é feito por autenticação/autorização no backend, não por esconder o
código.

```
escala-cc/
├── backend/     API em FastAPI (Python) + banco de dados
└── frontend/    Interface em React (Vite)
```

## Por que é seguro deixar o repositório público

Segurança de um sistema como esse não vem de esconder o código-fonte — vem de:

1. **Segredos fora do código.** `JWT_SECRET`, senha do banco, senha do
   primeiro admin: tudo em variáveis de ambiente (`.env`), nunca commitado
   (veja `.gitignore` em cada pasta). O `.env.example` mostra o formato, sem
   valores reais.
2. **Senhas com hash forte (Argon2id)**, nunca em texto puro. Nem o admin
   consegue ver a senha de ninguém no banco.
3. **Autenticação por token (JWT) de vida curta** (15 min) + **refresh token**
   guardado em cookie `httpOnly` (inacessível a JavaScript, o que reduz o
   risco de roubo por XSS) e revogável (logout de verdade).
4. **Controle de acesso por perfil** em toda rota que muda dado — só admin
   cria/edita/aprova; colaborador só vê e solicita o que é dele.
5. **Limite de tentativas de login** (rate limit por IP + bloqueio de conta
   após tentativas erradas repetidas) contra força bruta.
6. **CORS restrito** à URL exata do frontend — nenhum outro site consegue
   chamar a API usando a sessão de alguém.
7. **Cabeçalhos de segurança** (`X-Frame-Options`, `X-Content-Type-Options`
   etc.) em toda resposta.
8. **Validação de entrada rígida** (Pydantic) em tudo que a API recebe.
9. **Log de auditoria** (`audit_log`): toda ação sensível (login, aprovação,
   desligamento, mudança de equipe...) fica registrada com quem fez, quando e
   de qual IP.
10. **Dependabot habilitado** (`.github/dependabot.yml`) — o próprio GitHub
    abre PR automaticamente quando uma dependência tiver uma falha de
    segurança conhecida.

O que isso **não** substitui: HTTPS em produção (a hospedagem cuida disso —
Render/Railway/Vercel já servem com HTTPS por padrão), e bom senso ao gerar o
`JWT_SECRET` e as senhas (use os comandos sugeridos no `.env.example`).

## O que já está pronto (testado localmente antes de entregar)

- Login, refresh de sessão, logout, troca de senha
- Cadastro de colaboradores (com senha inicial provisória)
- **Mudança de equipe/turno com histórico obrigatório** (`PATCH /colaboradores/{id}`,
  motivo sempre exigido, fica registrado em `historico_equipe`)
- **Desligamento** (`POST /colaboradores/{id}/desligar`): vira soft-delete
  (`status=inativo`), nunca apaga nada — todo o histórico de plantões,
  folgas, atestados e férias continua intacto para relatórios. Antes ou
  depois de desligar, `GET /colaboradores/{id}/pendencias-desligamento`
  mostra plantões futuros e solicitações em aberto que precisam de atenção.
  Não deixa desligar o único admin ativo.
- Plantões: cadastro manual, templates de horário, geração automática por
  domingo/feriado com critério de justiça (quem tem menos plantões recentes)
- Solicitação/aprovação de folga (com motivo obrigatório na rejeição e aviso
  de conflito de horário parecido/igual entre colegas)
- Atestados, férias (fluxo em 3 etapas), feriados (obrigatório/facultativo)
- Avisos (por enquanto só painel — ver "Próximos passos")

## O que falta portar

O frontend aqui é um **esqueleto real** (login funcionando + uma tela de
exemplo já puxando dados da API) — não um port 1:1 de todas as telas do
protótipo do Claude. As telas que faltam (Plantões, Cronograma, Aprovações,
Férias, Feriados, Avisos) seguem exatamente o mesmo padrão:

1. Copie o JSX/CSS da tela equivalente no artifact do Claude
2. Troque as chamadas `window.storage.get/set` por `api.get/post/patch` do
   `src/api/client.js` (os nomes de campo mudam de `camelCase` para
   `snake_case`, ex: `colaboradorId` → `colaborador_id`)
3. Pronto — a validação de negócio (elegibilidade, justiça, conflito de
   horário) já roda no servidor, então a tela só precisa mostrar o resultado

---

## Rodando localmente

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edite o .env: gere um JWT_SECRET forte e defina o admin inicial
python -c "import secrets; print(secrets.token_urlsafe(64))"   # cole em JWT_SECRET

uvicorn app.main:app --reload
```

Na primeira subida com o banco vazio, se `FIRST_ADMIN_EMAIL` e
`FIRST_ADMIN_PASSWORD` estiverem no `.env`, o admin já é criado
automaticamente (com `must_change_password=true`, então troque a senha no
primeiro login).

Documentação interativa da API: `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # aponte VITE_API_URL pro backend
npm run dev
```

Abra `http://localhost:5173`.

---

## Deploy (sugestão de stack gratuita/barata para este porte)

| Peça | Onde | Por quê |
|---|---|---|
| Banco de dados | [Neon](https://neon.tech) ou [Supabase](https://supabase.com) (Postgres gerenciado) | Free tier, backup automático |
| Backend (API) | [Railway](https://railway.app) ou [Render](https://render.com) | Deploy direto do GitHub, HTTPS automático |
| Frontend | [Vercel](https://vercel.com) ou [Netlify](https://netlify.com) | Deploy direto do GitHub, HTTPS automático |

Passo geral:

1. Suba este repositório pro GitHub (pode ser público, seguindo os pontos de
   segurança acima).
2. Crie o banco Postgres → copie a `DATABASE_URL`.
3. No Railway/Render: aponte para a pasta `backend/`, configure as variáveis
   de ambiente do `.env.example` (nunca no código), start command
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
4. No Vercel/Netlify: aponte para a pasta `frontend/`, configure
   `VITE_API_URL` com a URL pública do backend.
5. Depois que o frontend tiver URL definitiva, volte no backend e atualize
   `FRONTEND_ORIGIN` para essa URL exata (senão o CORS bloqueia).

## Próximos passos recomendados

- **Alembic** para migrações de schema versionadas (hoje as tabelas são
  criadas automaticamente na primeira subida — ótimo para começar, mas
  quando já houver dado real em produção, migrações versionadas evitam
  perda de dado em mudanças de schema).
- **Notificações por e-mail/Teams** (Microsoft Graph API) — o design já
  guarda o campo `canais` em cada aviso pronto para isso; hoje só usa
  `["painel"]` por decisão do MVP1.
- **Agendador** (cron real) para chamar `POST /avisos/gerar` uma vez por dia
  automaticamente — hoje é uma rota que o admin pode chamar manualmente ou
  via GitHub Actions com `schedule:`.
- **2FA** para contas de admin, se o RH/compliance exigir.
- Portar as telas restantes do frontend (ver seção acima).
