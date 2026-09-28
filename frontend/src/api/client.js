// Em produção, por padrão usa URL relativa (mesma origem da página) — assim
// funciona tanto acessando com porta (:8043) quanto sem porta, sem depender
// de nenhum .env no servidor. Em desenvolvimento (npm run dev), cai pro
// backend local na 8000. VITE_API_URL, se definido, sempre tem prioridade
// (útil pra um caso especial, mas não é mais necessário em produção).
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

/**
 * Guardamos o access token só em memória (uma variável de módulo), nunca em
 * localStorage/sessionStorage. Isso reduz bastante o risco de um ataque XSS
 * conseguir roubar o token — ele não sobrevive a um reload de página, mas o
 * refresh token (cookie httpOnly, inacessível a JavaScript) resolve isso
 * automaticamente chamando /auth/refresh.
 */
let accessToken = null;
let onSessionExpired = () => {};

export function setAccessToken(token) {
  accessToken = token;
}

export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

async function refreshAccessToken() {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.access_token;
  return data;
}

async function request(path, { method = "GET", body, retry = true } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request(path, { method, body, retry: false });
    }
    onSessionExpired();
    throw new Error("Sessão expirada.");
  }

  if (!res.ok) {
    let detail = "Erro na requisição.";
    try {
      const data = await res.json();
      detail = Array.isArray(data.detail)
        ? data.detail.map((d) => d.msg).join(" ")
        : data.detail || detail;
    } catch (_) { /* resposta sem corpo JSON */ }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
  API_URL,
};
