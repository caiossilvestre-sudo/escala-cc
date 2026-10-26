import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Toast } from "../components/UI";
import { useToast } from "../lib/hooks";
import { TIPO_INFO, tipoDe, origemTexto, linkNvr, dataHora, lerArquivo, reduzirImagem } from "./util";
import Solicitar from "./Solicitar";
import "./ferramentas.css";

const CHIPS = [["", "Todas"], ["nvr_life", "NVR Life"], ["nvr_cliente", "NVR externo"], ["lifeguard", "LifeGuard"]];
const POR_PAGINA = 30;

/** Ficha da câmera no celular: foto grande, dados em lista e botões fixos embaixo. */
function FichaCelular({ cameraId, onVoltar, showToast }) {
  const [cam, setCam] = useState(null);
  const [foto, setFoto] = useState(null);
  const [erro, setErro] = useState("");
  const [pedido, setPedido] = useState(null); // tipo inicial da solicitação aberta
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => {
    api.get(`/ferramentas/cameras/${cameraId}`).then((c) => {
      setCam(c);
      if (c.tem_foto) api.get(`/ferramentas/cameras/${cameraId}/foto`).then((f) => setFoto(`data:${f.mime};base64,${f.imagem_base64}`)).catch(() => setFoto(null));
      else setFoto(null);
    }).catch((e) => setErro(e.message));
  }, [cameraId]);
  useEffect(() => { carregar(); }, [carregar]);

  // N1/N2 (pode editar) troca a foto direto; técnico manda como solicitação
  const trocarFoto = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = "";
    if (!arq) return;
    setEnviando(true);
    try {
      await api.post(`/ferramentas/cameras/${cam.id}/foto`, { imagem_base64: await reduzirImagem(await lerArquivo(arq)) });
      showToast("Foto da documentação atualizada.");
      carregar();
    } catch (err) { showToast(err.message); } finally { setEnviando(false); }
  };

  if (erro) return <div className="ft-cel-vazio">{erro}</div>;
  if (!cam) return <div className="ft-cel-vazio">Carregando…</div>;
  const g = cam.gravador;
  const t = TIPO_INFO[tipoDe(cam)];
  const linhas = [
    ["Cliente", cam.nome_cliente], ["Contrato", cam.contrato_ixc, true], ["Cidade", cam.cidade],
    [cam.tipo === "lifeguard" ? "ID LifeGuard" : "Gravador", cam.tipo === "lifeguard" ? cam.lg_id : g?.nome, cam.tipo === "lifeguard"],
    [cam.tipo === "lifeguard" ? "Porta LifeGuard" : "Canal", cam.tipo === "lifeguard" ? cam.porta_lifeguard : cam.canal, true],
    ["IP da câmera", cam.ip, true], ["MAC", cam.mac, true], ["IP do PPPoE", cam.ip_pppoe, true], ["PPPoE", cam.pppoe, true],
    ["Modelo", cam.modelo], ["Situação", cam.status === "online" ? "Online" : cam.status === "offline" ? "Offline" : null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div className="ft-cel">
      <div className="ft-cel-topo claro">
        <button type="button" className="ft-cel-voltar" onClick={onVoltar} aria-label="Voltar para a lista">‹</button>
        <div style={{ minWidth: 0 }}>
          <div className="display ft-cel-titulo">{cam.nome}</div>
          <div className="ft-ficha-sub">{cam.descricao_local || origemTexto(cam)}</div>
        </div>
      </div>
      <div className="ft-cel-corpo">
        <div className="ft-cel-foto">
          {foto ? <img src={foto} alt={`Imagem da câmera ${cam.nome}`} /> : <span>{cam.tem_foto ? "Carregando foto…" : "Sem foto de documentação"}</span>}
          {cam.foto_em && <small>Foto de {dataHora(cam.foto_em)}</small>}
        </div>
        <div className="ft-cel-cartao">
          <div className="ft-cel-linha"><span>Origem</span><span><span className={`pill ${t.pill}`}>{t.label}</span> <span className="mono" style={{ fontSize: 12 }}>{origemTexto(cam)}</span></span></div>
          {linhas.map(([k, v, mono]) => <div key={k} className="ft-cel-linha"><span>{k}</span><span className={mono ? "mono" : ""}>{String(v)}</span></div>)}
        </div>
        {cam.observacoes && <div className="ft-cel-cartao" style={{ whiteSpace: "pre-line", fontSize: 12.5, padding: 12 }}>{cam.observacoes}</div>}
        {linkNvr(g?.url_acesso) && <a className="ft-cel-nvr" href={linkNvr(g.url_acesso)} target="_blank" rel="noopener noreferrer">↗ Abrir o NVR</a>}
        {cam.solicitacoes_abertas > 0 && (
          <div className="warn-box" style={{ margin: 0 }}>{cam.solicitacoes_abertas === 1 ? "1 solicitação" : `${cam.solicitacoes_abertas} solicitações`} em análise pelo N2 para esta câmera.</div>
        )}
      </div>
      {(cam.pode_solicitar || cam.pode_editar) && (
        <div className="ft-cel-botoes">
          {cam.pode_editar ? (
            <label className="btn btn-ghost" style={{ cursor: enviando ? "wait" : "pointer" }}>
              {enviando ? "Enviando…" : "📷 Trocar foto"}
              <input type="file" accept="image/*" capture="environment" onChange={trocarFoto} disabled={enviando} style={{ display: "none" }} />
            </label>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setPedido("foto")}>📷 Enviar foto</button>
          )}
          {cam.pode_solicitar && <button type="button" className="btn btn-primary" onClick={() => setPedido("dados")}>Solicitar alteração</button>}
        </div>
      )}
      {pedido && (
        <Solicitar camera={cam} tipoInicial={pedido} showToast={showToast}
          onFechar={() => setPedido(null)} onEnviado={() => { setPedido(null); carregar(); }} />
      )}
    </div>
  );
}

/** Documentação no celular: busca com cartões grandes → ficha → solicitação. */
export default function DocCelular() {
  const { toast, showToast } = useToast();
  const [busca, setBusca] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [semFoto, setSemFoto] = useState(false);
  const [itens, setItens] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [sel, setSel] = useState(null);

  // menu do Escala mais enxuto enquanto esta tela está aberta no celular
  useEffect(() => {
    document.body.classList.add("ft-celular");
    return () => document.body.classList.remove("ft-celular");
  }, []);

  const pedidoAtual = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => { if (busca !== q) { setQ(busca); setPagina(1); } }, 350);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const meu = ++pedidoAtual.current;
    setCarregando(true);
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q.trim()) p.set("q", q.trim());
    if (tipo) p.set("tipo", tipo);
    if (semFoto) p.set("sem_foto", "true");
    api.get(`/ferramentas/cameras?${p}`)
      .then((r) => {
        if (meu !== pedidoAtual.current) return; // resposta de uma busca antiga
        setTotal(r.total);
        setItens((ant) => (pagina === 1 ? r.itens : [...ant, ...r.itens]));
      })
      .catch((e) => showToast(e.message))
      .finally(() => { if (meu === pedidoAtual.current) setCarregando(false); });
  }, [q, tipo, semFoto, pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  // a lista continua montada (só escondida) para voltar no mesmo ponto
  return (
    <>
    {sel && <FichaCelular key={sel} cameraId={sel} onVoltar={() => setSel(null)} showToast={showToast} />}
    <div className="ft-cel" style={sel ? { display: "none" } : undefined}>
      <div className="ft-cel-topo">
        <div className="display ft-cel-titulo" style={{ color: "white" }}>LifeGuard · Documentação</div>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" placeholder="Cliente, contrato, IP, câmera…" className="ft-cel-busca" />
        <div className="ft-cel-chips">
          {CHIPS.map(([v, l]) => <button key={v} type="button" className={tipo === v ? "on" : ""} aria-pressed={tipo === v} onClick={() => { setTipo(v); setPagina(1); }}>{l}</button>)}
          <button type="button" className={semFoto ? "on" : ""} aria-pressed={semFoto} onClick={() => { setSemFoto((s) => !s); setPagina(1); }}>Sem foto</button>
        </div>
      </div>
      <div className="ft-cel-corpo">
        <div className="ft-cel-qtd">{carregando && pagina === 1 ? "Buscando…" : `${total.toLocaleString("pt-BR")} câmera${total === 1 ? "" : "s"}`}</div>
        {itens.map((c) => {
          const t = TIPO_INFO[tipoDe(c)];
          return (
            <button key={c.id} type="button" className="ft-cel-item" onClick={() => setSel(c.id)}>
              <span className={`ft-cel-mini ${c.tem_foto ? "tem" : ""}`} aria-hidden="true" />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="n">{c.nome}</span>
                <span className="c">{c.nome_cliente || c.descricao_local || "—"}</span>
                <span className="o"><span className={`pill ${t.pill}`}>{t.label}</span> {origemTexto(c)}</span>
              </span>
              <span className="seta" aria-hidden="true">›</span>
            </button>
          );
        })}
        {!carregando && !itens.length && <div className="ft-cel-vazio">Nenhuma câmera encontrada.</div>}
        {itens.length < total && (
          <button type="button" className="btn btn-ghost" style={{ width: "100%", minHeight: 44 }} disabled={carregando} onClick={() => setPagina((p) => p + 1)}>
            {carregando ? "Carregando…" : "Carregar mais"}
          </button>
        )}
      </div>
    </div>
    <Toast toast={toast} />
    </>
  );
}
