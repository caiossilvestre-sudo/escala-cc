// Ponte com o LifeGuard rodando no computador do atendente.
//
// O navegador chama o LifeGuard local (http://127.0.0.1:<porta>), que é quem
// alcança as câmeras na rede da Life. O LifeGuard devolve a imagem / os dados
// do equipamento e a página manda para o servidor do Escala. Contrato das
// rotas: ver INTEGRACAO.md (seção "LifeGuard").
//
// O endereço fica salvo só neste navegador (localStorage) — cada atendente
// pode ter o LifeGuard numa porta diferente.

const CHAVE = "ft_lifeguard_url";
const PADRAO = "http://127.0.0.1:5000";

export function urlLifeGuard() {
  try { return localStorage.getItem(CHAVE) || PADRAO; } catch (_) { return PADRAO; }
}

export function salvarUrlLifeGuard(url) {
  try { localStorage.setItem(CHAVE, url.trim().replace(/\/+$/, "")); } catch (_) { /* sem storage: usa o padrão */ }
}

async function chamar(caminho, corpo, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${urlLifeGuard()}${caminho}`, {
      method: corpo ? "POST" : "GET",
      headers: corpo ? { "Content-Type": "application/json" } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dados.erro || `LifeGuard respondeu ${res.status}.`);
    return dados;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("O LifeGuard demorou demais para responder.");
    if (e instanceof TypeError) throw new Error(`Não consegui falar com o LifeGuard em ${urlLifeGuard()}. Ele está aberto neste computador?`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** { ok, versao } */
export const pingLifeGuard = () => chamar("/api/escala/ping", null, 4000);

/** Lê modelo, firmware, MAC e compressão do equipamento.
 * alvo: { tipo, ip, porta, canal, gravador_url, lg_id } -> { modelo, firmware, mac, compressao } */
export const detectarPeloLifeGuard = (alvo) => chamar("/api/escala/detectar", alvo);

/** Captura um quadro da câmera. -> { imagem_base64 (JPEG), largura, altura } */
export const capturarPeloLifeGuard = (alvo) => chamar("/api/escala/snapshot", alvo, 40000);
