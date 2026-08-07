import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { formatBRDia, formatBR, TIPO_LABEL } from "../lib/helpers";

export default function Aprovacoes() {
  const solicitacoes = useApiList("/solicitacoes");
  const colaboradores = useApiList("/colaboradores");
  const plantoes = useApiList("/plantoes");
  const { toast, showToast } = useToast();
  const [rejeitandoId, setRejeitandoId] = useState(null);
  const [motivo, setMotivo] = useState("");

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";
  const pendentes = solicitacoes.data.filter((s) => s.status === "pendente");
  const resolvidas = solicitacoes.data.filter((s) => s.status !== "pendente");

  const resolver = async (id, aprovar, motivoRejeicao) => {
    try {
      await api.post(`/solicitacoes/${id}/resolver`, { aprovar, motivo_rejeicao: motivoRejeicao || null });
      showToast(aprovar ? "Folga aprovada." : "Folga rejeitada — motivo registrado.");
      solicitacoes.reload();
      setRejeitandoId(null); setMotivo("");
    } catch (e) { showToast(e.message); }
  };

  const loading = solicitacoes.loading || colaboradores.loading || plantoes.loading;

  return (
    <>
      <TopBar title="Aprovações" subtitle="Colaboradores apenas solicitam — a validação final é do admin" />
      <div className="content">
        <ErrorBox error={solicitacoes.error} />
        {loading ? <Spinner /> : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Pendentes ({pendentes.length})</div>
              {pendentes.length === 0 ? <div className="empty">Nenhuma solicitação pendente.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {pendentes.map((s) => {
                    const plantao = plantoes.data.find((p) => p.id === s.plantao_id);
                    return (
                      <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{nome(s.colaborador_id)} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {TIPO_LABEL[s.tipo]}</span></div>
                            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{formatBRDia(s.data_solicitada)} {plantao && `· plantão de ${formatBR(plantao.data)}`}</div>
                          </div>
                          {rejeitandoId !== s.id && (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button className="btn btn-success btn-sm" onClick={() => resolver(s.id, true)}>Aprovar</button>
                              <button className="btn btn-danger btn-sm" onClick={() => setRejeitandoId(s.id)}>Rejeitar</button>
                            </div>
                          )}
                        </div>
                        {rejeitandoId === s.id && (
                          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <textarea rows={2} placeholder="Motivo da rejeição (o colaborador vai ver este texto)" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontSize: 12.5, fontFamily: "inherit" }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <button className="btn btn-danger btn-sm" onClick={() => resolver(s.id, false, motivo)}>Confirmar</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => { setRejeitandoId(null); setMotivo(""); }}>Cancelar</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="card">
              <div className="section-title">Histórico</div>
              {resolvidas.length === 0 ? <div className="empty">Sem histórico ainda.</div> : (
                <table className="tbl">
                  <thead><tr><th>Colaborador</th><th>Tipo</th><th>Data</th><th>Status</th><th>Motivo</th></tr></thead>
                  <tbody>{resolvidas.map((s) => (
                    <tr key={s.id}><td>{nome(s.colaborador_id)}</td><td>{TIPO_LABEL[s.tipo]}</td><td className="mono">{formatBRDia(s.data_solicitada)}</td><td><Pill status={s.status}>{s.status === "aprovada" ? "Aprovada" : "Rejeitada"}</Pill></td><td style={{ color: "var(--text-muted)" }}>{s.motivo_rejeicao || "—"}</td></tr>
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
