// Prints / imagens da Passagem de plantão: enviar (arquivo ou Ctrl+V) e ver.
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { lerArquivo, reduzirImagem, baixarImagem, dataHora } from "./util";

export const MAX_ANEXOS = 6;

// Cache das imagens já baixadas nesta aba (id -> dados), para não buscar de novo.
const cache = new Map();
function carregar(id) {
  if (!cache.has(id)) cache.set(id, api.get(`/ferramentas/passagem/anexos/${id}`).catch((e) => { cache.delete(id); throw e; }));
  return cache.get(id);
}

function Miniatura({ id, nome, onAbrir, onTirar }) {
  const [dado, setDado] = useState(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    carregar(id).then((d) => vivo && setDado(d)).catch(() => vivo && setErro(true));
    return () => { vivo = false; };
  }, [id]);
  return (
    <div className="pp-anexo">
      <button type="button" className="pp-anexo-img" title={nome || "Abrir imagem"} onClick={() => dado && onAbrir(dado)} disabled={!dado}>
        {dado ? <img src={dado.imagem_base64} alt={nome || "Anexo"} /> : <span>{erro ? "indisponível" : "…"}</span>}
      </button>
      {onTirar && <button type="button" className="pp-anexo-x" aria-label="Remover anexo" title="Remover" onClick={onTirar}>×</button>}
    </div>
  );
}

function Visualizador({ dado, onFechar }) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);
  return (
    <div className="pp-lightbox" role="dialog" aria-modal="true" aria-label="Imagem anexada" onClick={onFechar}>
      <div className="pp-lightbox-caixa" onClick={(e) => e.stopPropagation()}>
        <div className="pp-lightbox-topo">
          <span>{dado.nome || "Imagem"}{dado.criado_por ? ` · ${dado.criado_por}` : ""}{dado.criado_em ? ` · ${dataHora(dado.criado_em)}` : ""}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => baixarImagem(dado.imagem_base64, (dado.nome || "print").replace(/\.\w+$/, ""))}>Baixar</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Fechar</button>
          </div>
        </div>
        <img src={dado.imagem_base64} alt={dado.nome || "Imagem anexada"} />
      </div>
    </div>
  );
}

/** Lista de miniaturas só para ver. anexos = [{id, nome}] */
export function AnexosVer({ anexos }) {
  const [aberto, setAberto] = useState(null);
  if (!anexos?.length) return null;
  return (
    <>
      <div className="pp-anexos">{anexos.map((a) => <Miniatura key={a.id} id={a.id} nome={a.nome} onAbrir={setAberto} />)}</div>
      {aberto && <Visualizador dado={aberto} onFechar={() => setAberto(null)} />}
    </>
  );
}

/** Enviar prints: botão "Anexar print" ou Ctrl+V dentro do bloco. value = [{id, nome}] */
export function AnexosEditor({ value, onChange, showToast, rotulo = "Anexar print" }) {
  const [enviando, setEnviando] = useState(0);
  const [aberto, setAberto] = useState(null);
  const input = useRef(null);
  const caixa = useRef(null);
  const lista = value || [];
  const atual = useRef(lista);
  atual.current = lista;
  const mudar = useRef(onChange);
  mudar.current = onChange;

  const enviar = async (arquivos) => {
    const imagens = [...arquivos].filter((f) => f.type?.startsWith("image/"));
    if (!imagens.length) return;
    const espaco = MAX_ANEXOS - atual.current.length;
    if (espaco <= 0) { showToast?.(`Máximo de ${MAX_ANEXOS} imagens.`); return; }
    for (const f of imagens.slice(0, espaco)) {
      setEnviando((n) => n + 1);
      try {
        const reduzida = await reduzirImagem(await lerArquivo(f), 1920, 0.88);
        const r = await api.post("/ferramentas/passagem/anexos", { imagem_base64: reduzida, nome: f.name && f.name !== "image.png" ? f.name : "print" });
        cache.set(r.id, Promise.resolve({ ...r, imagem_base64: reduzida }));
        atual.current = [...atual.current, { id: r.id, nome: r.nome }];
        mudar.current(atual.current);
      } catch (e) { showToast?.(e.message || "Não foi possível enviar a imagem."); } finally { setEnviando((n) => n - 1); }
    }
    if (imagens.length > espaco) showToast?.(`Máximo de ${MAX_ANEXOS} imagens — as demais ficaram de fora.`);
  };

  // Ctrl+V com um print funciona em qualquer campo do bloco (o mais próximo
  // marcado com data-colar, ex.: a pendência inteira), não só no botão.
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  useEffect(() => {
    const alvo = caixa.current?.closest("[data-colar]") || caixa.current;
    if (!alvo) return undefined;
    const colar = (e) => {
      const arquivos = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
      if (arquivos.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); e.stopPropagation(); enviarRef.current(arquivos); }
    };
    alvo.addEventListener("paste", colar);
    return () => alvo.removeEventListener("paste", colar);
  }, []);

  return (
    <div className="pp-anexos-editor" ref={caixa} tabIndex={-1}>
      <div className="pp-anexos">
        {lista.map((a) => (
          <Miniatura key={a.id} id={a.id} nome={a.nome} onAbrir={setAberto} onTirar={() => onChange(lista.filter((x) => x.id !== a.id))} />
        ))}
        {enviando > 0 && <div className="pp-anexo"><div className="pp-anexo-img"><span>enviando…</span></div></div>}
      </div>
      {lista.length < MAX_ANEXOS && (
        <div className="pp-anexos-acoes">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={enviando > 0}>📎 {rotulo}</button>
          <span className="pp-dica">ou cole um print aqui (Ctrl+V)</span>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { enviar(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {aberto && <Visualizador dado={aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}
