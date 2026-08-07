import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { todayISO, formatBR } from "../lib/helpers";

const STAGES = ["solicitada", "enviado_rh", "aprovada"];
const STAGE_LABEL = { solicitada: "Solicitado", enviado_rh: "Enviado ao RH", aprovada: "Retorno recebido" };

export function FeriasAdmin() {
  const { data, loading, error, reload } = useApiList("/ferias");
  const colaboradores = useApiList("/colaboradores");
  const { toast, showToast } = useToast();
  const [nota, setNota] = useState({});

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";
  const abertas = data.filter((f) => f.status === "solicitada" || f.status === "enviado_rh");
  const concluidas = data.filter((f) => ["aprovada", "ajustar", "rejeitada"].includes(f.status));

  const avancar = async (id, status) => {
    try {
      await api.post(`/ferias/${id}/avancar`, { status, nota_admin: nota[id] || null });
      showToast("Atualizado.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  return (
    <>
      <TopBar title="Férias" subtitle="Fluxo em 3 etapas: solicitação → envio ao RH → retorno ao colaborador" />
      <div className="content">
        <ErrorBox error={error} />
        {loading ? <Spinner /> : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Em andamento ({abertas.length})</div>
              {abertas.length === 0 ? <div className="empty">Nenhuma solicitação em aberto.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {abertas.map((f) => (
                    <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <div><b>{nome(f.colaborador_id)}</b><div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{formatBR(f.data_inicio)} – {formatBR(f.data_fim)}</div></div>
                        <Pill status={f.status}>{STAGE_LABEL[f.status]}</Pill>
                      </div>
                      <textarea rows={2} placeholder="Observação (opcional)" defaultValue={f.nota_admin || ""} onChange={(e) => setNota({ ...nota, [f.id]: e.target.value })} style={{ width: "100%", marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontSize: 12.5, fontFamily: "inherit" }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        {f.status === "solicitada" && (
                          <>
                            <button className="btn btn-primary btn-sm" onClick={() => avancar(f.id, "enviado_rh")}>Marcar como enviado ao RH</button>
                            <button className="btn btn-danger btn-sm" onClick={() => avancar(f.id, "rejeitada")}>Rejeitar já</button>
                          </>
                        )}
                        {f.status === "enviado_rh" && (
                          <>
                            <button className="btn btn-success btn-sm" onClick={() => avancar(f.id, "aprovada")}>Aprovar e avisar colaborador</button>
                            <button className="btn btn-danger btn-sm" onClick={() => avancar(f.id, "ajustar")}>Retornar pedindo ajuste</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <div className="section-title">Concluídas</div>
              {concluidas.length === 0 ? <div className="empty">Sem histórico ainda.</div> : (
                <table className="tbl">
                  <thead><tr><th>Colaborador</th><th>Período</th><th>Status</th><th>Observação</th></tr></thead>
                  <tbody>{concluidas.map((f) => (
                    <tr key={f.id}><td>{nome(f.colaborador_id)}</td><td className="mono">{formatBR(f.data_inicio)}–{formatBR(f.data_fim)}</td>
                      <td><Pill status={f.status === "aprovada" ? "aprovada" : f.status === "ajustar" ? "ajustar" : "rejeitada"}>{f.status === "aprovada" ? "Aprovada" : f.status === "ajustar" ? "Ajuste solicitado" : "Rejeitada"}</Pill></td>
                      <td style={{ color: "var(--text-muted)" }}>{f.nota_admin || "—"}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      <Toast toast={toast} />
    </>
  );
}

export default function MinhasFerias({ user }) {
  const { data, loading, error, reload } = useApiList("/ferias");
  const { toast, showToast } = useToast();
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataFim, setDataFim] = useState(todayISO());

  const enviar = async () => {
    if (dataFim < dataInicio) { showToast("Data final não pode ser antes da inicial."); return; }
    try {
      await api.post("/ferias", { data_inicio: dataInicio, data_fim: dataFim });
      showToast("Solicitação de férias enviada.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  const stageIndex = (status) => (status === "ajustar" || status === "rejeitada" ? -1 : STAGES.indexOf(status));
  const minhas = data.filter((f) => f.colaborador_id === user.colaborador_id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  return (
    <>
      <TopBar title="Minhas férias" subtitle="Solicitação em 3 etapas: você pede → o admin analisa e envia ao RH → você recebe o retorno" />
      <div className="content">
        <ErrorBox error={error} />
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Nova solicitação</div>
          <div className="form-grid">
            <div className="field"><label>Início</label><input type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); if (dataFim < e.target.value) setDataFim(e.target.value); }} /></div>
            <div className="field"><label>Fim</label><input type="date" value={dataFim} min={dataInicio} onChange={(e) => setDataFim(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary" onClick={enviar}>Solicitar férias</button>
        </div>
        <div className="card">
          <div className="section-title">Andamento das solicitações</div>
          {loading ? <Spinner /> : minhas.length === 0 ? <div className="empty">Você ainda não solicitou férias.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {minhas.map((f) => {
                const idx = stageIndex(f.status);
                const rejeitadoOuAjuste = f.status === "ajustar" || f.status === "rejeitada";
                return (
                  <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{formatBR(f.data_inicio)} – {formatBR(f.data_fim)}</div>
                      {rejeitadoOuAjuste && <Pill status={f.status === "ajustar" ? "ajustar" : "rejeitada"}>{f.status === "ajustar" ? "Precisa ajustar" : "Não aprovado"}</Pill>}
                    </div>
                    {!rejeitadoOuAjuste && (
                      <>
                        <div className="stage-track">
                          {STAGES.map((st, i) => (
                            <span key={st} style={{ display: "contents" }}>
                              <span className={`dot ${i <= idx ? "done" : ""}`}>{i + 1}</span>
                              {i < STAGES.length - 1 && <span className={`line ${i < idx ? "done" : ""}`} />}
                            </span>
                          ))}
                        </div>
                        <div className="stage-labels"><span>Solicitado</span><span>Enviado ao RH</span><span>Retorno</span></div>
                      </>
                    )}
                    {f.nota_admin && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: rejeitadoOuAjuste ? 8 : 0 }}>Observação do admin: {f.nota_admin}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
