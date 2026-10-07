# Módulo Ferramentas · LifeGuard Documentação — como integrar no Escala

O módulo é **só documentação**: cadastro das câmeras, senhas dos gravadores e
uma foto por câmera, importada e exportada por arquivo. O servidor não roda
captura, ffmpeg nem nada que fale com câmera.

Os arquivos vão nos mesmos caminhos do repositório `escala-cc`. Copie por cima
no seu diretório local, faça commit + push pelo GitHub Desktop e depois
`git pull` no servidor.

## O que fica no repositório

| Caminho | O que é |
|---|---|
| `backend/app/ferramentas/` | Tabelas (`ft_*`), rotas (`/ferramentas`), permissões, criptografia das senhas, fotos, importação da planilha |
| `backend/app/main.py` | 2 linhas: import e `include_router` |
| `backend/requirements.txt` | `cryptography`, `Pillow`, `openpyxl` (e `psycopg2-binary>=2.9.10`) |
| `backend/.env.example` | 2 variáveis novas no final |
| `frontend/src/ferramentas/` | Telas React: Documentação, ficha, cadastro, importar fotos, permissões |
| `frontend/src/App.jsx` | 4 linhas para o grupo Ferramentas · LifeGuard |

**Nunca no repositório (ele é público):** a planilha, o relatório de
importação, fotos e CSVs exportados.

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

## 3. Frontend — `App.jsx`

A pasta `frontend/src/ferramentas/` já está pronta. No `App.jsx` são 3 ajustes
(o arquivo completo também vai no pacote):

```jsx
// (1) junto dos outros imports
import { FerramentasPagina, useFerramentasAcesso } from "./ferramentas";

// (2) dentro do Shell(), logo depois do useIdleLogout(...)
const ft = useFerramentasAcesso(user?.colaborador_id);

// (3) trocar a linha do `const nav = ...` por:
const navBase = showAdminPages ? NAV_ADMIN : isSupervisor ? NAV_SUPERVISOR : NAV_COLAB;
const nav = ft.nav ? [...navBase, ft.nav] : navBase;

// (4) junto dos outros {activeTab === ...}, dentro do <fieldset>
<FerramentasPagina tab={activeTab} acesso={ft} />
```

O grupo **Ferramentas · LifeGuard** tem uma página só: **Documentação**. Ele
aparece para quem tem pelo menos "consultar". Se um dia entrar outra página,
ela vai em `ferramentas/index.js` — **não precisa mexer de novo no App.jsx**.

Atenção: o `<fieldset disabled={isViewer}>` do App desabilita tudo para o
perfil visualizador — mesmo com permissão em Ferramentas ele só consegue
consultar.

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

## 6. Permissões (por página/tópico)

Na Documentação, quem tem "Gerenciar permissões" vê o botão **Permissões**: uma
linha por colaborador, uma caixinha por permissão, salva na hora (e vai para o
`audit_log`). Atalhos **N1** / **N2** / **Nenhum** só preenchem as caixinhas.

| Permissão | Libera |
|---|---|
| Documentação · consultar e exportar | lista, ficha, foto, exportar foto e lista CSV |
| Documentação · cadastrar/editar e importar fotos | cadastrar/editar câmera, importar foto (uma ou em lote) |
| Documentação · ver senhas e editar gravadores | mostrar senhas (auditado), gravadores e credenciais |
| Documentação · excluir câmeras | excluir |
| Gerenciar permissões | a tela de permissões |

Atalhos: **N1** = consultar + cadastrar/importar · **N2** = N1 + senhas.

Admin do Escala tem tudo, sempre. Marcar qualquer permissão de Documentação
marca "consultar" junto. Sem nenhuma caixinha, a pessoa não vê o grupo no menu.

As permissões ficam na tabela `ft_acessos` (criada sozinha ao reiniciar). A
tabela antiga `ft_permissoes` (por nível) não é mais usada — pode apagar:
`DROP TABLE ft_permissoes;` no psql.

---

## 7. Cadastro de câmeras

"+ Nova câmera" abre o cadastro em 3 passos:

1. **Identificar o cliente** — busca quem já está na documentação (nome,
   contrato, ID IXC ou PPPoE) e preenche os dados; mostra quantas câmeras ele
   já tem. Cliente novo: é só digitar.
2. **Onde as câmeras gravam** — NVR (escolhe o gravador) ou LifeGuard (ID).
3. **Dados das câmeras** — uma linha por câmera, "+ Adicionar câmera" / "+ 4".
   No NVR, o próximo canal livre é sugerido. Cada linha pode ter foto e
   "Mais dados" (porta, modelo, firmware, compressão, dias, observações).

**Nenhum campo é obrigatório.** Ao salvar, se faltar cliente, contrato,
gravador, nome, canal/ID, IP ou MAC, aparece "Está faltando: … Deseja salvar
mesmo assim?". Câmera sem nome recebe "CANAL n", "LG id" ou "Sem nome".
O lote é **tudo ou nada**: se um canal já estiver documentado, nada é gravado
e a mensagem diz qual câmera da lista é.

---

## 8. Fotos — exportar e importar

O sistema **não captura imagem nenhuma** e não fala com câmeras nem com o
LifeGuard. As fotos são geradas fora (pelo seu script Python ou pelo
"Exportar frame" do LifeGuard Console) e importadas na documentação.

**Exportar**
- **Lista de câmeras (CSV)** — botão "Exportar lista (CSV)" na Documentação
  (respeita os filtros de tipo e cidade). Separado por `;`, abre direto no
  Excel. Tem `id`, gravador, canal, ID LifeGuard, cliente, contrato, IP do
  PPPoE, portas, se já tem foto e a coluna **`arquivo_sugerido`** — o nome
  que o arquivo da foto deve ter para entrar sozinho na importação.
  **Sem senhas.**
- **Foto de uma câmera** — "Exportar foto" na ficha.

**Importar**
- **Uma câmera** — "Importar foto" na ficha (ou no cadastro).
- **Em lote** — botão "Importar fotos", dois jeitos de nomear os arquivos:
  - **Por gravador:** escolha o NVR e selecione os arquivos `CANAL 01.jpg`,
    `CANAL 02.jpg`… (é o formato do .zip do "Exportar frame" do Console —
    extraia o .zip antes). Também aceita `CH1.jpg`, `CAM01.jpg` ou só `01.jpg`.
  - **Por id:** `<id-da-câmera>.jpg` (coluna `arquivo_sugerido` do CSV) ou
    `LG11157.jpg` para câmeras LifeGuard.

  A tela mostra, antes de enviar, qual arquivo vai para qual câmera e quais
  não foram reconhecidos. Por padrão **não substitui** foto que já existe —
  marque "Substituir fotos que já existem" se quiser. As imagens são reduzidas
  para 1280 px no navegador antes de subir. Cada lote fica no `audit_log`
  (`ft_foto_lote`), com quem importou e quais arquivos.

---

## 9. Rotas da API (referência)

| Método | Rota | Permissão |
|---|---|---|
| GET | `/ferramentas/me` | logado |
| GET | `/ferramentas/resumo`, `/cidades`, `/clientes?q=`, `/cameras`, `/cameras/{id}`, `/cameras/{id}/foto`, `/cameras-exportar`, `/gravadores`, `/gravadores/{id}` | doc.ver |
| POST/PATCH | `/ferramentas/cameras`, `/cameras/lote`, `/cameras/{id}`; POST `/cameras/{id}/foto`, `/fotos/mapear`, `/fotos/lote` | doc.editar |
| POST/PATCH | `/ferramentas/gravadores`; POST/DELETE `/credenciais`; POST `/credenciais/{id}/revelar` (auditado) | doc.senhas |
| DELETE | `/ferramentas/cameras/{id}` | doc.excluir |
| GET/POST | `/ferramentas/permissoes` | ft.admin |
