import { useEffect, useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { formatBRDia, TIPO_LABEL } from "../lib/helpers";

function CotaBadge({ colaboradorId }) {
  const [resumo, setResumo] = useState(null);
  useEffect(() => {
    api.get(`/solicitacoes/cotas-sindicato?colaborador_id=${colaboradorId}`).then(setResumo).catch(() => {});
  }, [colaboradorId]);
  if (!resumo) return null;
  return (
    <span className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)", marginLeft: 6 }} title={resumo.cotas.map((c) => `${c.nome}: ${c.usada ? "usada" : "livre"}`).join(" · ")}>
      ({resumo.total_usadas}/{resumo.total_disponivel} folgas sindicato usadas em {resumo.ciclo})
    </span>
  );
}

export default function Aprovacoes() {
  const { data, loading, error, reload } = useApiList("/solicitacoes");
  const colaboradores = useApiList("/colaboradores");
  const { toast, showToast } = useToast();
  const [rejeitandoId, setRejeitandoId] = useState(null);
  const [motivo, setMotivo] = useState("");

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";
  const pendentes = data.filter((s) => s.status === "pendente");
  const resolvidas = data.filter((s) => s.status !== "pendente").sort((a, b) => b.data_solicitada.localeCompare(a.data_solicitada));

  const resolver = async (id, aprovar, motivoRejeicao) => {
    try {
      await api.post(`/solicitacoes/${id}/resolver`, { aprovar, motivo_rejeicao: motivoRejeicao || null });
      showToast(aprovar ? "Folga aprovada." : "Folga rejeitada — motivo registrado.");
      reload();
      setRejeitandoId(null); setMotivo("");
    } catch (e) { showToast(e.message); }
  };

  const reabrir = async (id) => {
    if (!window.confirm("Reabrir esta solicitação para poder decidir de novo?")) return;
    try {
      await api.post(`/solicitacoes/${id}/reabrir`);
      showToast("Solicitação reaberta — ela volta pra lista de pendentes.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  return (
    <>
      <TopBar title="Aprovações" subtitle="Solicitações de folga aguardando decisão" />
      <div className="content">
        <ErrorBox error={error} />
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Pendentes ({pendentes.length})</div>
          {loading ? <Spinner /> : pendentes.length === 0 ? <div className="empty">Nenhuma solicitação pendente.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pendentes.map((s) => (
                <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <b>{nome(s.colaborador_id)}</b>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {TIPO_LABEL[s.tipo]} · <span className="mono">{formatBRDia(s.data_solicitada)}</span>
                        {s.tipo === "folga_sindicato" && <CotaBadge colaboradorId={s.colaborador_id} />}
                      </div>
                    </div>
                    <Pill status="pendente">Pendente</Pill>
                  </div>
                  {rejeitandoId === s.id ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea rows={2} placeholder="Motivo da rejeição (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontSize: 12.5, fontFamily: "inherit" }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button className="btn btn-danger btn-sm" onClick={() => resolver(s.id, false, motivo)}>Confirmar rejeição</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setRejeitandoId(null); setMotivo(""); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="btn btn-success btn-sm" onClick={() => resolver(s.id, true)}>Aprovar</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setRejeitandoId(s.id)}>Rejeitar</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-title">Histórico</div>
          {resolvidas.length === 0 ? <div className="empty">Sem histórico ainda.</div> : (
            <table className="tbl">
              <thead><tr><th>Colaborador</th><th>Tipo</th><th>Data</th><th>Status</th><th>Motivo</th><th></th></tr></thead>
              <tbody>{resolvidas.map((s) => (
                <tr key={s.id}><td>{nome(s.colaborador_id)}</td><td>{TIPO_LABEL[s.tipo]}</td><td className="mono">{formatBRDia(s.data_solicitada)}</td><td><Pill status={s.status}>{s.status === "aprovada" ? "Aprovada" : "Rejeitada"}</Pill></td><td style={{ color: "var(--text-muted)" }}>{s.motivo_rejeicao || "—"}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => reabrir(s.id)}>Reabrir</button></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
