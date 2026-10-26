import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { TopBar, Spinner, ErrorBox, Toast, ConfirmModal } from "../components/UI";
import { useToast, useConfirm } from "../lib/hooks";
import { CATEGORIAS, PARA, PassagemUsuario, PendenciaCard } from "./passagemUtil";
import PassagemForm from "./PassagemForm";
import PassagemHistorico, { PassagemDetalhe } from "./PassagemHistorico";
import PassagemGestor from "./PassagemGestor";
import Permissoes from "./Permissoes";
import "./ferramentas.css";

/** Ferramentas › Plantão › Passagem de plantão (12x36). */
export default function Passagem({ acesso }) {
  const { toast, showToast } = useToast();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [aba, setAba] = useState("inicio"); // inicio | historico | gestor
  const [form, setForm] = useState(null); // null | { existente? }
  const [permissoes, setPermissoes] = useState(false);
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [equipe, setEquipe] = useState(null); // null = ainda não escolhida
  const [filtroCat, setFiltroCat] = useState("");
  const [filtroPara, setFiltroPara] = useState("");
  const [verResolvidas, setVerResolvidas] = useState(false);
  const [resolvidas, setResolvidas] = useState(null);

  const carregar = useCallback(() => {
    setErro("");
    const q = equipe ? `?equipe=${encodeURIComponent(equipe)}` : "";
    return api.get(`/ferramentas/passagem/painel${q}`).then((r) => {
      setPainel(r);
      // primeira vez: abre no setor da pessoa, se ele tiver passagens
      if (equipe === null) setEquipe(r.equipes.includes(r.minha_equipe) ? r.minha_equipe : "");
    }).catch((e) => setErro(e.message));
  }, [equipe]);
  useEffect(() => { carregar(); }, [carregar]);

  const carregarResolvidas = useCallback(() => {
    const q = new URLSearchParams({ status: "resolvida", limite: "40" });
    if (equipe) q.set("equipe", equipe);
    return api.get(`/ferramentas/passagem/pendencias?${q}`).then(setResolvidas).catch((e) => showToast(e.message));
  }, [equipe, showToast]);
  useEffect(() => { if (verResolvidas) carregarResolvidas(); }, [verResolvidas, carregarResolvidas]);

  const pendencias = useMemo(() => (painel?.pendencias || []).filter((p) =>
    (!filtroCat || p.categoria === filtroCat) && (!filtroPara || p.para === filtroPara)), [painel, filtroCat, filtroPara]);

  const mudouPendencia = (nova) => {
    setPainel((pn) => {
      const pendencias = nova.status === "aberta"
        ? (pn.pendencias.some((x) => x.id === nova.id) ? pn.pendencias.map((x) => (x.id === nova.id ? nova : x)) : [nova, ...pn.pendencias])
        : pn.pendencias.filter((x) => x.id !== nova.id);
      const contagem = Object.fromEntries(CATEGORIAS.map((c) => [c.id, pendencias.filter((x) => x.categoria === c.id).length]));
      return { ...pn, pendencias, contagem };
    });
    if (verResolvidas) carregarResolvidas();
  };

  const darCiencia = async () => {
    try { await api.post(`/ferramentas/passagem/${painel.ultima.id}/ciencia`); showToast("Ciência registrada. Bom plantão!"); carregar(); } catch (e) { showToast(e.message); }
  };

  const fecharForm = (salvou) => { setForm(null); if (salvou) { carregar(); setAba("inicio"); } };
  const extras = (<><Toast toast={toast} /><ConfirmModal state={confirmState} onResolve={resolveConfirm} /></>);

  if (permissoes) return (<><Permissoes onVoltar={() => setPermissoes(false)} showToast={showToast} />{extras}</>);

  if (form) {
    return (
      <>
        <TopBar title={form.existente ? "Editar passagem de plantão" : "Registrar passagem de plantão"} subtitle="O que houve no plantão e o que precisa ser visto depois" />
        <div className="content">
          <PassagemForm
            existente={form.existente} sugestao={painel?.sugestao} abertasAnteriores={painel?.pendencias?.length || 0}
            userId={painel?.eu} onVoltar={fecharForm} showToast={showToast}
          />
        </div>
        {extras}
      </>
    );
  }

  const gerencia = !!painel?.gerencia;
  const ultima = painel?.ultima;
  const total = painel?.pendencias?.length || 0;

  return (
    <PassagemUsuario.Provider value={{ eu: painel?.eu, gerencia }}>
      <TopBar
        title="Passagem de plantão"
        subtitle="Plantão 12x36 — o que houve e o que ficou para o próximo turno ou para o horário comercial"
        right={<button type="button" className="btn btn-primary" onClick={() => setForm({})} disabled={!painel}>+ Registrar passagem</button>}
      />
      <div className="content">
        <ErrorBox error={erro} />
        <div className="pp-abas">
          <div className="ft-seg" role="tablist" aria-label="Seções">
            <button type="button" role="tab" aria-selected={aba === "inicio"} className={aba === "inicio" ? "on" : ""} onClick={() => setAba("inicio")}>Pendências <span className="qtd">{total}</span></button>
            <button type="button" role="tab" aria-selected={aba === "historico"} className={aba === "historico" ? "on" : ""} onClick={() => setAba("historico")}>Histórico</button>
            {gerencia && <button type="button" role="tab" aria-selected={aba === "gestor"} className={aba === "gestor" ? "on" : ""} onClick={() => setAba("gestor")}>Painel do gestor</button>}
          </div>
          {painel && painel.equipes.length > 1 && (
            <div className="ft-filtros" style={{ margin: 0 }}>
              <select value={equipe || ""} onChange={(e) => setEquipe(e.target.value)} aria-label="Setor">
                <option value="">Todos os setores</option>
                {painel.equipes.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          )}
        </div>

        {!painel ? (!erro && <Spinner />) : aba === "historico" ? (
          <PassagemHistorico equipe={equipe} gerencia={gerencia} eu={painel.eu} showToast={showToast} confirm={confirm} onEditar={(p) => setForm({ existente: p })} />
        ) : aba === "gestor" && gerencia ? (
          <PassagemGestor equipe={equipe} showToast={showToast} onPermissoes={acesso?.tem("ft.admin") ? () => setPermissoes(true) : null} />
        ) : (
          <>
            {ultima ? (
              <div className={`card pp-ultima${!ultima.ciencia_em ? " aguardando" : ""}`}>
                <div className="pp-rotulo" style={{ marginBottom: 6 }}>Última passagem</div>
                <PassagemDetalhe
                  p={ultima} compacto showToast={showToast}
                  onCiencia={painel.pode_dar_ciencia ? darCiencia : null}
                  onEditar={(ultima.autor_id === painel.eu && !ultima.ciencia_em) || gerencia ? () => setForm({ existente: ultima }) : null}
                />
              </div>
            ) : (
              <div className="info-box">Nenhuma passagem registrada ainda. Ao fim do plantão, clique em <b>&nbsp;+ Registrar passagem&nbsp;</b> — dá para ir anotando durante o turno, o rascunho fica salvo.</div>
            )}

            <div className="pp-filtros">
              <button type="button" className={`ft-chip${!filtroCat ? " on" : ""}`} onClick={() => setFiltroCat("")}>Todas <span className="qtd">{total}</span></button>
              {CATEGORIAS.map((c) => (
                <button key={c.id} type="button" className={`ft-chip${filtroCat === c.id ? " on" : ""}`} onClick={() => setFiltroCat(filtroCat === c.id ? "" : c.id)}>
                  {c.nome} <span className="qtd">{painel.contagem[c.id] || 0}</span>
                </button>
              ))}
              <select className="pp-select" value={filtroPara} onChange={(e) => setFiltroPara(e.target.value)} aria-label="Ver em">
                <option value="">Próximo plantão e horário comercial</option>
                {Object.entries(PARA).map(([k, v]) => <option key={k} value={k}>Só {v.toLowerCase()}</option>)}
              </select>
            </div>

            {pendencias.length === 0 ? (
              <div className="card"><div className="empty">{total ? "Nenhuma pendência neste filtro." : "Nenhuma pendência aberta. Tudo em dia! ✅"}</div></div>
            ) : (
              <div className="pp-lista">
                {pendencias.map((p) => <PendenciaCard key={p.id} p={p} showToast={showToast} onMudou={mudouPendencia} />)}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button type="button" className="ft-link" onClick={() => setVerResolvidas((v) => !v)}>{verResolvidas ? "Esconder resolvidas" : "Ver resolvidas recentemente"}</button>
              {verResolvidas && (
                !resolvidas ? <Spinner /> : resolvidas.length === 0 ? <div className="empty">Nenhuma pendência resolvida ainda.</div> : (
                  <div className="pp-lista" style={{ marginTop: 10 }}>
                    {resolvidas.map((p) => <PendenciaCard key={p.id} p={p} showToast={showToast} onMudou={mudouPendencia} />)}
                  </div>
                )
              )}
            </div>
          </>
        )}
      </div>
      {extras}
    </PassagemUsuario.Provider>
  );
}
