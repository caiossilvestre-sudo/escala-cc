# Módulo Ferramentas · LifeGuard Documentação — como integrar no Escala

Este pacote tem **só arquivos novos e 3 arquivos completos já alterados**, nos
mesmos caminhos do repositório `escala-cc`. Copie por cima no seu diretório
local, faça commit + push pelo GitHub Desktop e depois `git pull` no servidor.

## O que vem no pacote

| Caminho | O que é |
|---|---|
| `backend/app/ferramentas/` | **Pasta nova.** Tabelas (`ft_*`), rotas (`/ferramentas`), permissões, criptografia das senhas, fotos e o script de importação |
| `backend/app/main.py` | Arquivo completo — só **2 linhas novas** (import e `include_router`) |
| `backend/requirements.txt` | Arquivo completo — 3 dependências novas no final |
| `backend/.env.example` | Arquivo completo — 2 variáveis novas no final |
| `frontend/src/ferramentas/` | **Pasta nova.** Telas React (lista, ficha, cadastro, permissões, diagnóstico) |
| `para_o_lifeguard/escala_bridge.py` | **Não vai no Escala.** Vai no projeto do LifeGuard (ver seção LifeGuard) |
| `relatorio_importacao_simulacao.xlsx` | Resultado da simulação com a sua planilha (sem senhas) |

`frontend/src/App.jsx` **não vem no pacote** — você vai ajustar na conversa do
Escala. Os trechos estão na seção 3.

---

## 1. Backend

Duas linhas no `backend/app/main.py` (já aplicadas no arquivo do pacote):

```python
from app.ferramentas import router as ferramentas_router      # junto dos outros imports
...
app.include_router(ferramentas_router)  # depois do routes_configuracoes
```

As tabelas novas (`ft_permissoes`, `ft_gravadores`, `ft_cameras`,
`ft_credenciais`) são criadas sozinhas pelo `create_all` que o Escala já roda
no startup. Nenhuma tabela existente é alterada.

### Variáveis novas no `.env` do servidor

```bash
# chave que cifra as senhas dos gravadores — gere UMA vez e guarde em backup
FERRAMENTAS_CHAVE_CRIPTO=<saída do comando abaixo>
# pasta das fotos da documentação (fora do git, do usuário do serviço)
FERRAMENTAS_FOTOS_DIR=/var/lib/escala-ferramentas/fotos
```

Gerar a chave (no venv do backend):

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> **Se a chave for perdida, as senhas importadas não podem mais ser lidas.**
> Guarde-a junto do backup do `.env`. A pasta de fotos também entra no backup.

---

## 2. Nginx — prefixo `/ferramentas`

Como todo prefixo novo, `/ferramentas` precisa ser liberado em
`/etc/nginx/sites-available/escala.conf`, no mesmo formato dos outros
prefixos que vão para o backend. Exemplo (ajuste o `proxy_pass` para o que os
outros blocos já usam):

```nginx
location /ferramentas {
    proxy_pass http://127.0.0.1:8000;      # mesmo destino dos outros prefixos
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;              # a foto vai em base64 no corpo
}
```

Depois: `sudo nginx -t && sudo systemctl reload nginx`.

Sem isso a tela abre, mas tudo dá "Erro na requisição".

---

## 3. Frontend — o que levar para a conversa do Escala

A pasta `frontend/src/ferramentas/` já está pronta. No `App.jsx` são 4 ajustes:

```jsx
// (1) junto dos outros imports
import { LifeGuardDocumentacao, LifeGuardDiagnostico, NAV_FERRAMENTAS, useFerramentasNivel } from "./ferramentas";

// (2) dentro do Shell(), logo depois do useIdleLogout(...)
const ftNivel = useFerramentasNivel(user?.colaborador_id);

// (3) trocar a linha do `const nav = ...` por:
const navBase = showAdminPages ? NAV_ADMIN : isSupervisor ? NAV_SUPERVISOR : NAV_COLAB;
const nav = ftNivel ? [...navBase, NAV_FERRAMENTAS] : navBase;

// (4) junto dos outros {activeTab === ...}, dentro do <fieldset>
{activeTab === "lg-documentacao" && ftNivel && <LifeGuardDocumentacao nivel={ftNivel} />}
{activeTab === "lg-diagnostico" && ftNivel && <LifeGuardDiagnostico />}
```

O grupo **Ferramentas** (LifeGuard · Documentação / LifeGuard · Diagnóstico)
só aparece para quem tem acesso ao módulo. Admin do Escala sempre tem.

Atenção: o `<fieldset disabled={isViewer}>` do App desabilita tudo para o
perfil visualizador. Se um visualizador da escala receber nível em Ferramentas,
ele vai conseguir só consultar. Se quiser que ele cadastre câmeras, o módulo
precisa ficar fora desse fieldset (decisão para a conversa do Escala).

---

## 4. Deploy no servidor (ordem)

```bash
cd <pasta do escala no servidor>
git pull

# backend
source backend/venv/bin/activate          # o venv que o escala.service usa
pip install -r backend/requirements.txt
sudo mkdir -p /var/lib/escala-ferramentas/fotos
sudo chown <usuario-do-servico>: /var/lib/escala-ferramentas -R
nano backend/.env                         # adicionar as 2 variáveis
sudo systemctl restart escala

# frontend
cd frontend && npm run build

# nginx (seção 2)
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Importar a planilha

Copie a planilha para o servidor (pela VPN) e rode **primeiro a simulação**:

```bash
cd backend && source venv/bin/activate
python -m app.ferramentas.importar_planilha /tmp/planilha.xlsx
```

Ela não grava nada: mostra o resumo e gera `relatorio_importacao_<data>.xlsx`
com as pendências (sem senhas). Revisado, grave de verdade:

```bash
python -m app.ferramentas.importar_planilha /tmp/planilha.xlsx --aplicar
rm /tmp/planilha.xlsx      # a planilha tem senhas em texto puro
```

Pode rodar de novo sem duplicar: só entra o que ainda não existe.

### O que a importação faz

- **"NVR - Interno"** vira gravadores **NVR Life** (instalados na Life).
  **"NVR - Externos (Cliente)"** vira **NVR externo** (instalados no cliente).
  **"Life Guard"** vira câmeras LifeGuard (só as linhas com ID da câmera).
- **Fica de fora:** as outras abas (resumos, contagens, cópia "(2)", centrais
  de alarme). As centrais entram numa próxima etapa.
- **Canais vazios** (sem nome, IP, MAC nem descrição) não viram câmera. O canal
  livre é calculado pelo sistema.
- **"STATUS CANAL"** da planilha quer dizer *canal ocupado/livre*, não câmera
  funcionando. Por isso toda câmera entra como "Sem diagnóstico". Câmera
  documentada num canal marcado como "disponível" vai para o relatório.
- **Padronização:**
  - MAC sempre no formato `AA:BB:CC:DD:EE:FF`;
  - cidades unificadas (Marilia-sp, Marilila, MARILIA → Marília; Ppa → Pompeia; P.nobrega → Padre Nóbrega);
  - compressão como H.264/H.265;
  - IP sem espaço.
- **Valor inválido:** IP, MAC ou IP do PPPoE inválido não se perde, vai para o
  campo Observações da câmera. Com mais de um contrato na célula, entra o
  primeiro e os outros vão para Observações.
- **Senhas dos gravadores:** usuário e senha juntados por NVR, sem repetição, e
  gravados **cifrados**. No NVR Life, o usuário que aparece só para um cliente
  fica marcado como daquele cliente. A ficha da câmera mostra os usuários
  gerais do NVR mais os do cliente da câmera.
- **Endereço digitado na coluna de usuário** não vira credencial e vai para o
  relatório.

Resultado da simulação com a sua planilha:

| Item | Quantidade |
|---|---|
| Gravadores NVR Life | 12 |
| Gravadores NVR externos | 26 |
| Câmeras em NVR Life | 882 |
| Câmeras em NVR externo | 1.704 |
| Câmeras LifeGuard | 27 |
| Credenciais (usuário único por NVR) | 283 |
| Canais vazios ignorados | 304 |
| Linhas com pendência no relatório | 301 |

---

## 6. Permissões

Na tela LifeGuard · Documentação, o admin tem o botão **Permissões**:

| Nível | Pode |
|---|---|
| **N1** | consultar, cadastrar e editar câmeras, tirar/atualizar a foto |
| **N2** | + ver senhas dos gravadores (cada visualização vai para o `audit_log`), editar gravadores e credenciais |
| **Admin** | + excluir e definir permissões. Todo admin do Escala é admin aqui |

Sem nível definido, a pessoa não vê o grupo Ferramentas no menu.

---

## 7. LifeGuard — captura e detecção

A página chama o LifeGuard que está aberto **no computador do atendente**
(padrão `http://127.0.0.1:5000`, editável na tela de cadastro). É ele quem
alcança as câmeras. O LifeGuard devolve a imagem e a página manda para o
servidor.

No projeto do LifeGuard:

1. Copie `para_o_lifeguard/escala_bridge.py`.
2. Onde o Flask app é criado:

   ```python
   from escala_bridge import registrar_ponte_escala
   registrar_ponte_escala(
       app,
       origem_escala="https://escala-suporte.duckdns.org:8043",
       credenciais=lambda alvo: [("admin", "senha1"), ("admin", "senha2")],  # use a lista que o LifeGuard já tem
   )
   ```

3. `requests` precisa estar no build do PyInstaller.

Rotas criadas:

| Rota | Resposta |
|---|---|
| `GET /api/escala/ping` | `{ok, versao}` |
| `POST /api/escala/detectar` | `{modelo, firmware, mac, compressao}`: ISAPI (Hikvision) ou CGI (Intelbras/Dahua) |
| `POST /api/escala/snapshot` | `{imagem_base64, largura, altura}`: snapshot HTTP do NVR (por canal) ou da câmera, com RTSP+ffmpeg como plano B |

A ponte já envia os cabeçalhos de CORS e o `Access-Control-Allow-Private-Network`
que o Chrome exige para uma página https falar com o 127.0.0.1, liberados só
para a origem do Escala.

Os caminhos ISAPI/CGI foram testados contra uma câmera simulada, não contra os
seus equipamentos. Teste com uma câmera de cada marca antes de liberar.

**Sem o LifeGuard** dá para usar "Ou enviar um arquivo" no cadastro.

---

## 8. Rotas da API (referência)

| Método | Rota | Nível |
|---|---|---|
| GET | `/ferramentas/me` | logado |
| GET | `/ferramentas/resumo`, `/ferramentas/cidades` | N1 |
| GET | `/ferramentas/cameras?q=&tipo=nvr_life\|nvr_cliente\|lifeguard&status=&cidade=&sem_foto=&pagina=` | N1 |
| GET/POST/PATCH | `/ferramentas/cameras/{id}` | N1 |
| DELETE | `/ferramentas/cameras/{id}` | Admin |
| GET/POST | `/ferramentas/cameras/{id}/foto` | N1 |
| GET | `/ferramentas/gravadores`, `/ferramentas/gravadores/{id}` | N1 |
| POST/PATCH | `/ferramentas/gravadores` | N2 |
| POST/DELETE | `/ferramentas/credenciais` | N2 |
| POST | `/ferramentas/credenciais/{id}/revelar` | N2 (auditado) |
| GET/POST | `/ferramentas/permissoes` | Admin |
