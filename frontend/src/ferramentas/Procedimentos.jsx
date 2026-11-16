import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { ErrorBox, Spinner, TopBar } from "../components/UI";
import { dataHora } from "./util";
import "./ferramentas.css";

const semAcento = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const EXEMPLOS = ["câmera Garen sem imagem", "cliente sem internet", "liberar porta no roteador", "ramal não registra", "validar rádio no PRTG"];

// Prints vêm com o token da sessão (não dá para usar <img src> direto na API)
const cacheImg = new Map();
function useImagem(nome) {
  const [url, setUrl] = useState(cacheImg.get(nome) || null);
  useEffect(() => {
    if (!nome || cacheImg.has(nome)) return undefined;
    let vivo = true;
    api.blob(`/ferramentas/pops/arquivo/${nome}`).then((b) => {
      const u = URL.createObjectURL(b);
      cacheImg.set(nome, u);
      if (vivo) setUrl(u);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [nome]);
  return url;
}

function Miniatura({ nome, onAbrir }) {
  const url = useImagem(nome);
  return (
    <button type="button" className="pr-mini" onClick={() => url && onAbrir(url)} title="Ampliar">
      {url ? <img src={url} alt="Print do procedimento" loading="lazy" /> : <span className="pr-mini-vazio" />}
    </button>
  );
}

/** Destaca no texto as palavras que bateram com a busca (comparação sem acento, pela raiz). */
function Destacado({ texto, termos }) {
  const partes = useMemo(() => {
    if (!termos?.length) return [texto];
    return texto.split(/([\p{L}\p{N}]+)/u).map((p, i) => {
      const n = semAcento(p);
      const bate = n.length >= 2 && termos.some((t) => n.startsWith(t) || (n.length > 4 && n.endsWith("s") && n.slice(0, -1).startsWith(t)));
      return bate ? <mark key={i}>{p}</mark> : p;
    });
  }, [texto, termos]);
  return <div className="pr-texto">{partes}</div>;
}

function Trecho({ t, termos, onAbrir }) {
  return (
    <>
      {t.texto && <Destacado texto={t.texto} termos={termos} />}
      {!!t.imagens?.length && (
        <div className="pr-imgs">{t.imagens.map((n) => <Miniatura key={n} nome={n} onAbrir={onAbrir} />)}</div>
      )}
    </>
  );
}

function Resultado({ r, termos, onAbrir }) {
  const [viz, setViz] = useState(null);
  const verMais = () => api.get(`/ferramentas/pops/trecho/${r.trecho_id}/vizinhos`).then(setViz).catch(() => setViz([]));
  const antes = viz?.filter((v) => v.antes) || [];
  const depois = viz?.filter((v) => !v.antes) || [];
  return (
    <article className="card pr-res">
      <header className="pr-res-topo">
        <div>
          <div className="pr-res-cod">
            {r.codigo && <span className="pill ft-life">{r.codigo}{r.versao ? ` v${r.versao}` : ""}</span>}
            <h3>{r.titulo}</h3>
          </div>
          <div className="pr-res-onde">{r.secao || "Início do documento"}{r.pagina ? ` · página ${r.pagina}` : ""}</div>
        </div>
        <a className="btn btn-ghost btn-sm" href={r.link} target="_blank" rel="noopener noreferrer">Abrir PDF ↗</a>
      </header>
      {antes.map((v) => <div key={v.id} className="pr-viz"><div className="pr-res-onde">{v.secao} · página {v.pagina}</div><Trecho t={v} termos={termos} onAbrir={onAbrir} /></div>)}
      <Trecho t={r} termos={termos} onAbrir={onAbrir} />
      {depois.map((v) => <div key={v.id} className="pr-viz"><div className="pr-res-onde">{v.secao} · página {v.pagina}</div><Trecho t={v} termos={termos} onAbrir={onAbrir} /></div>)}
      {viz === null && <button type="button" className="pr-mais" onClick={verMais}>Ver o trecho anterior e o seguinte</button>}
    </article>
  );
}

function Lista({ pops }) {
  const [filtro, setFiltro] = useState("");
  const grupos = useMemo(() => {
    const f = semAcento(filtro.trim());
    const g = new Map();
    pops.filter((p) => !f || semAcento(`${p.codigo || ""} ${p.titulo} ${p.caminho}`).includes(f)).forEach((p) => {
      const pasta = p.caminho.split("/").slice(0, -1).join(" › ");
      if (!g.has(pasta)) g.set(pasta, []);
      g.get(pasta).push(p);
    });
    return [...g.entries()];
  }, [pops, filtro]);
  return (
    <section className="card">
      <div className="pr-lista-topo">
        <h2 className="section-title" style={{ margin: 0 }}>Todos os procedimentos</h2>
        <input type="search" placeholder="Filtrar por código ou nome…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      </div>
      {grupos.map(([pasta, itens]) => (
        <div key={pasta} className="pr-grupo">
          <div className="pr-grupo-nome">{pasta}</div>
          {itens.map((p) => (
            <a key={p.id} className="pr-item" href={p.link} target="_blank" rel="noopener noreferrer">
              <span className="mono">{p.codigo ? `${p.codigo}${p.versao ? ` v${p.versao}` : ""}` : "—"}</span>
              <span>{p.titulo}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ))}
      {!grupos.length && <div className="ft-vazio">Nada com esse nome.</div>}
    </section>
  );
}

function SemResposta({ onFechar }) {
  const [linhas, setLinhas] = useState(null);
  useEffect(() => { api.get("/ferramentas/pops/buscas-sem-resultado").then(setLinhas).catch(() => setLinhas([])); }, []);
  return (
    <div className="ft-gaveta-fundo" style={{ justifyContent: "center", alignItems: "center" }} onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="card ac-modal" role="dialog" aria-label="Perguntas sem resposta">
        <div className="ac-modal-topo"><h3>Perguntas sem resposta</h3><button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>✕</button></div>
        <p className="pr-dica">O que a equipe procurou e não achou em nenhum POP — candidatos a procedimento novo.</p>
        {!linhas ? <Spinner /> : !linhas.length ? <div className="ft-vazio">Nenhuma até agora.</div> : (
          <table className="tbl"><thead><tr><th>Pergunta</th><th>Vezes</th><th>Última</th></tr></thead>
            <tbody>{linhas.map((l) => <tr key={l.termo}><td>{l.termo}</td><td>{l.vezes}</td><td>{dataHora(l.ultima)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Procedimentos: pergunta em texto livre → trechos dos POPs com os prints. */
export default function Procedimentos({ acesso }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState(null); // { q, termos, resultados } | "carregando"
  const [ampliada, setAmpliada] = useState(null);
  const [verSem, setVerSem] = useState(false);
  const campo = useRef(null);

  useEffect(() => { api.get("/ferramentas/pops").then(setDados).catch((e) => setErro(e.message)); }, []);

  const buscar = (texto) => {
    const t = (texto ?? q).trim();
    if (t.length < 2) return;
    setQ(t);
    setBusca("carregando");
    api.get(`/ferramentas/pops/buscar?q=${encodeURIComponent(t)}`)
      .then((r) => { setBusca(r); setErro(""); })
      .catch((e) => { setBusca(null); setErro(e.message); });
  };

  const limpar = () => { setQ(""); setBusca(null); campo.current?.focus(); };

  return (
    <>
      <TopBar
        title="Ferramentas · Procedimentos"
        subtitle={dados ? `${dados.pops.length} POPs${dados.ultima_sync ? ` · atualizado em ${dataHora(dados.ultima_sync)}` : ""}` : "POPs do SharePoint"}
        right={acesso?.tem("ft.admin") ? <button className="btn btn-ghost" onClick={() => setVerSem(true)}>Perguntas sem resposta</button> : null}
      />
      <div className="content">
        <ErrorBox error={erro} />
        <form className="pr-busca" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
          <input ref={campo} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder="Descreva a dúvida do seu jeito. Ex.: câmera Garen sem imagem no app" aria-label="Dúvida" />
          <button className="btn btn-primary" type="submit" disabled={q.trim().length < 2}>Buscar</button>
          {busca && <button className="btn btn-ghost" type="button" onClick={limpar}>Limpar</button>}
        </form>
        {!busca && (
          <div className="pr-exemplos">
            Experimente: {EXEMPLOS.map((e) => <button key={e} type="button" onClick={() => buscar(e)}>{e}</button>)}
          </div>
        )}

        {busca === "carregando" && <Spinner label="Procurando nos POPs…" />}
        {busca && busca !== "carregando" && (
          busca.resultados.length ? (
            <div className="pr-resultados">
              <p className="pr-dica">Trechos mais próximos da dúvida, direto dos POPs. Confira sempre o PDF completo.</p>
              {busca.resultados.map((r) => <Resultado key={r.trecho_id} r={r} termos={busca.termos} onAbrir={setAmpliada} />)}
            </div>
          ) : (
            <div className="card empty">
              Não encontrei nada nos POPs para <b>“{busca.q}”</b>.<br />
              Tente outras palavras (nome do sistema, equipamento ou sintoma) ou acione a coordenação.
            </div>
          )
        )}

        {!busca && (dados ? (dados.pops.length ? <Lista pops={dados.pops} /> : (
          <div className="card empty">Nenhum POP sincronizado ainda. A atualização acontece todo dia às 9h.</div>
        )) : !erro && <Spinner />)}
      </div>

      {ampliada && (
        <div className="ft-gaveta-fundo pr-zoom" onClick={() => setAmpliada(null)} role="dialog" aria-label="Print ampliado">
          <img src={ampliada} alt="Print ampliado" />
        </div>
      )}
      {verSem && <SemResposta onFechar={() => setVerSem(false)} />}
    </>
  );
}
