import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Spinner, ErrorBox } from "../components/UI";
import { dataHora } from "./util";
import { CATEGORIAS, PendenciaCard, TURNOS, diaMes, haQuanto, rotuloPlantao } from "./passagemUtil";

/** Passagem completa (o que houve, recado, o que ficou por categoria). */
export function PassagemDetalhe({ p, onCiencia, onEditar, onExcluir, onPendencia, showToast, compacto = false }) {
  const porCat = (c) => (p.pendencias || []).filter((x) => x.categoria === c);
  return (
    <div className="pp-detalhe">
      <div className="pp-detalhe-topo">
        <div>
          <div className="pp-detalhe-titulo">{rotuloPlantao(p)}</div>
          <div className="pp-meta">
            {p.autor}{p.equipe ? ` · ${p.equipe}` : ""} · enviada {dataHora(p.enviado_em)}{p.editado_em ? ` · editada ${dataHora(p.editado_em)}` : ""}
          </div>
        </div>
        <div className="pp-detalhe-acoes">
          {p.ciencia_em
            ? <span className="pill aprovada" title={dataHora(p.ciencia_em)}>Ciente: {p.ciencia_por} · {dataHora(p.ciencia_em)}</span>
            : <span className="pill pendente">Aguardando ciência há {haQuanto(p.enviado_em)}</span>}
          {onCiencia && <button type="button" className="btn btn-primary btn-sm" onClick={onCiencia}>Dar ciência</button>}
          {onEditar && <button type="button" className="btn btn-ghost btn-sm" onClick={onEditar}>Editar</button>}
          {onExcluir && <button type="button" className="btn btn-danger btn-sm" onClick={onExcluir}>Excluir</button>}
        </div>
      </div>

      <div className="pp-texto"><div className="pp-rotulo">O que houve</div>{p.resumo}</div>
      {p.recados && <div className="pp-texto pp-recado"><div className="pp-rotulo">Recado para o próximo plantão</div>{p.recados}</div>}

      <div className="pp-resumo-cats">
        {CATEGORIAS.map((c) => {
          const itens = porCat(c.id);
          const nada = (p.sem_pendencia || []).includes(c.id);
          if (!itens.length && !nada && c.id === "outro") return null;
          return (
            <span key={c.id} className={`pp-resumo-cat ${itens.length ? "tem" : nada ? "nada" : ""}`}>
              <span className={`pill pp-${c.id}`}>{c.nome}</span>{itens.length ? `${itens.length}` : nada ? "nada pendente" : "—"}
            </span>
          );
        })}
      </div>

      {!compacto && (p.pendencias || []).length > 0 && (
        <div className="pp-lista">
          {p.pendencias.map((x) => <PendenciaCard key={x.id} p={x} mostrarOrigem={false} showToast={showToast} onMudou={onPendencia} />)}
        </div>
      )}
    </div>
  );
}

/** Lista de passagens anteriores, com filtros. */
export default function PassagemHistorico({ equipe, gerencia, showToast, confirm, onEditar, eu }) {
  const [filtros, setFiltros] = useState({ autor_id: "", de: "", ate: "" });
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState(null); // passagem completa

  const carregar = useCallback(() => {
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (equipe) q.set("equipe", equipe);
    Object.entries(filtros).forEach(([k, v]) => { if (v) q.set(k, v); });
    setErro("");
    return api.get(`/ferramentas/passagem/historico?${q}`).then(setDados).catch((e) => setErro(e.message));
  }, [equipe, filtros, pagina]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrir = (id) => api.get(`/ferramentas/passagem/${id}`).then(setAberta).catch((e) => showToast(e.message));
  const filtro = (k, v) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(1); };

  const ciencia = async () => {
    try { await api.post(`/ferramentas/passagem/${aberta.id}/ciencia`); showToast("Ciência registrada."); abrir(aberta.id); carregar(); } catch (e) { showToast(e.message); }
  };
  const excluir = async () => {
    if (!(await confirm("A passagem e todas as pendências dela (abertas e resolvidas) serão apagadas. Fica registrado na auditoria.", { title: "Excluir passagem?", confirmLabel: "Excluir" }))) return;
    try { await api.delete(`/ferramentas/passagem/${aberta.id}`); showToast("Passagem excluída."); setAberta(null); carregar(); } catch (e) { showToast(e.message); }
  };

  if (aberta) {
    return (
      <div className="card">
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => { setAberta(null); carregar(); }}>← Voltar ao histórico</button>
        <PassagemDetalhe
          p={aberta} showToast={showToast}
          onCiencia={aberta.pode_dar_ciencia ? ciencia : null}
          onEditar={aberta.pode_editar ? () => onEditar(aberta) : null}
          onExcluir={gerencia ? excluir : null}
          onPendencia={() => abrir(aberta.id)}
        />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="ft-filtros">
        <select value={filtros.autor_id} onChange={(e) => filtro("autor_id", e.target.value)} aria-label="Quem registrou">
          <option value="">Todos os plantonistas</option>
          {(dados?.autores || []).map((a) => <option key={a.id} value={a.id}>{a.nome}{a.id === eu ? " (você)" : ""}</option>)}
        </select>
        <label className="chk">De <input type="date" value={filtros.de} onChange={(e) => filtro("de", e.target.value)} /></label>
        <label className="chk">Até <input type="date" value={filtros.ate} onChange={(e) => filtro("ate", e.target.value)} /></label>
      </div>
      <ErrorBox error={erro} />
      {!dados ? <Spinner /> : dados.itens.length === 0 ? <div className="empty">Nenhuma passagem encontrada.</div> : (
        <>
          <div className="ft-tabela-wrap">
            <table className="tbl pp-tabela">
              <thead><tr><th>Plantão</th><th>Plantonista</th><th>Pendências</th><th>Ciência</th><th>O que houve</th></tr></thead>
              <tbody>
                {dados.itens.map((p) => (
                  <tr key={p.id} tabIndex={0} onClick={() => abrir(p.id)} onKeyDown={(e) => { if (e.key === "Enter") abrir(p.id); }}>
                    <td style={{ whiteSpace: "nowrap" }}><b>{diaMes(p.data, true)}</b><div className="pp-meta">{TURNOS[p.turno]?.label} {p.horario_inicio}–{p.horario_fim}</div></td>
                    <td>{p.autor}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {p.qtd_pendencias === 0 ? <span className="pp-meta">nenhuma</span> : <>{p.qtd_abertas} {p.qtd_abertas === 1 ? "aberta" : "abertas"} de {p.qtd_pendencias}</>}
                      {p.qtd_alta > 0 && <span className="pill rejeitada" style={{ marginLeft: 6 }}>{p.qtd_alta} alta</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{p.ciencia_em ? <span className="pill aprovada">{p.ciencia_por}</span> : <span className="pill pendente">Aguardando</span>}</td>
                    <td className="pp-resumo-curto">{p.resumo_curto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dados.paginas > 1 && (
            <div className="ft-paginacao" style={{ marginTop: 12 }}>
              <span>{dados.total} passagens · página {pagina} de {dados.paginas}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pagina >= dados.paginas} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
