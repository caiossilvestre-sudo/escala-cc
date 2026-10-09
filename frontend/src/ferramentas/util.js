import { useLayoutEffect, useRef, useState } from "react";

// Utilitários do módulo Ferramentas (LifeGuard · Documentação).

export const TIPO_INFO = {
  nvr_life: { label: "NVR Life", pill: "ft-life", dica: "Gravador instalado na Life" },
  nvr_cliente: { label: "NVR externo", pill: "ft-cliente", dica: "Gravador instalado no cliente" },
  lifeguard: { label: "LifeGuard", pill: "ft-lg", dica: "Câmera LifeGuard (por ID)" },
};

export const STATUS_INFO = {
  online: { label: "Online", pill: "aprovada" },
  offline: { label: "Offline", pill: "rejeitada" },
  desconhecido: { label: "Sem diagnóstico", pill: "ft-desc" },
};

/** "nvr" + origem do gravador -> chave de TIPO_INFO */
export function tipoDe(cam) {
  if (cam.tipo === "lifeguard") return "lifeguard";
  const origem = cam.gravador_origem || cam.gravador?.origem;
  return origem === "cliente" ? "nvr_cliente" : "nvr_life";
}

export function origemTexto(cam) {
  if (cam.tipo === "lifeguard") return `ID ${cam.lg_id || "—"}${cam.porta_lifeguard ? ` · porta ${cam.porta_lifeguard}` : ""}`;
  const nome = cam.gravador_nome || cam.gravador?.nome || "—";
  return `${nome} · canal ${cam.canal ?? "—"}`;
}

/** Endereço do NVR pronto para abrir no navegador ("177.1.2.3:4100" -> "http://177.1.2.3:4100"). */
export function linkNvr(url, padrao = "http") {
  const u = (url || "").trim().replace(/\s+/g, "");
  if (!u || !/[.:]/.test(u)) return null;
  return /^https?:\/\//i.test(u) ? u : `${padrao}://${u}`;
}

export function dataHora(iso) {
  if (!iso) return "—";
  // o backend grava em UTC sem fuso; marca como UTC para mostrar no horário local
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function kb(bytes) {
  if (!bytes) return "";
  return `${Math.round(bytes / 1024)} KB`;
}

/** Reduz qualquer imagem para no máx. 1280 px de largura em JPEG — o envio
 * fica leve (~100–200 KB) e não estoura limite de upload do Nginx. */
export function reduzirImagem(fonte, larguraMax = 1280, qualidade = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, larguraMax / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * escala);
      canvas.height = Math.round(img.naturalHeight * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", qualidade));
    };
    img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    img.src = fonte;
  });
}

export function lerArquivo(arquivo) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(arquivo);
  });
}

/** Baixa a imagem no computador (exportar) — não envia nada ao servidor. */
export function baixarImagem(dataUrl, nomeBase) {
  const a = document.createElement("a");
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  a.href = dataUrl;
  a.download = `${(nomeBase || "camera").replace(/[^\w.-]+/g, "_")}_${carimbo}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const vazioParaNull = (obj) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]));

const TELA_LARGA = 1100; // abaixo disso a lista e a ficha ficam uma embaixo da outra

export const num = (n) => (n === null || n === undefined ? "…" : Number(n).toLocaleString("pt-BR"));

/** Altura do topo da página até o fim da janela: a página não rola, só a lista e a ficha. */
export function useAlturaRestante() {
  const ref = useRef(null);
  const [altura, setAltura] = useState(null);
  useLayoutEffect(() => {
    const calcular = () => {
      if (!ref.current || window.innerWidth <= TELA_LARGA) { setAltura(null); return; }
      const topo = ref.current.getBoundingClientRect().top + window.scrollY;
      setAltura(Math.max(480, window.innerHeight - topo));
    };
    calcular();
    window.addEventListener("resize", calcular);
    return () => window.removeEventListener("resize", calcular);
  }, []);
  return [ref, altura];
}
