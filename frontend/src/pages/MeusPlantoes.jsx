import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, ShiftStrip } from "../components/UI";
import { useApiList } from "../lib/hooks";
import { currentMonthKey, monthLabel, formatBRDia, addDays, formatBR } from "../lib/helpers";

export default function MeusPlantoes({ user }) {
  const [mes, setMes] = useState(currentMonthKey());
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const atestados = useApiList("/atestados");
  const ferias = useApiList("/ferias");

  const loading = plantoes.loading || solicitacoes.loading;
  const meusPlantoesMes = plantoes.data.filter((p) => p.colaborador_id === user.colaborador_id && p.data.slice(0, 7) === mes).sort((a, b) => a.data.localeCompare(b.data));

  return (
    <>
      <TopBar title={`Olá, ${user.nome.split(" ")[0]}`} subtitle="Seus plantões e o resumo visual do mês"
        right={<input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="mono" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} />} />
      <div className="content">
        <ErrorBox error={plantoes.error} />
        {loading ? <Spinner /> : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Visão do mês — {monthLabel(mes)}</div>
              <ShiftStrip colaboradorId={user.colaborador_id} monthKey={mes} plantoes={plantoes.data} solicitacoes={solicitacoes.data} atestados={atestados.data} ferias={ferias.data} />
              <div className="legend">
                <span className="item"><span className="sw" style={{ background: "var(--plantao)" }} />Plantão</span>
                <span className="item"><span className="sw" style={{ background: "var(--folga)" }} />Folga de plantão</span>
                <span className="item"><span className="sw" style={{ background: "var(--sindicato)" }} />Folga normal (sindicato)</span>
                <span className="item"><span className="sw" style={{ background: "var(--atestado)" }} />Atestado</span>
                <span className="item"><span className="sw" style={{ background: "var(--ferias)" }} />Férias</span>
                <span className="item"><span className="sw" style={{ background: "var(--border)" }} />Sem registro</span>
              </div>
            </div>
            <div className="card">
              <div className="section-title">Plantões de {monthLabel(mes)} ({meusPlantoesMes.length})</div>
              {meusPlantoesMes.length === 0 ? <div className="empty">Nenhum plantão neste mês.</div> : (
                <table className="tbl">
                  <thead><tr><th>Data</th><th>Horário</th><th>Tipo</th><th>Prazo p/ solicitar folga</th><th>Folga</th></tr></thead>
                  <tbody>{meusPlantoesMes.map((p) => {
                    const sol = solicitacoes.data.find((s) => s.plantao_id === p.id);
                    return (
                      <tr key={p.id}>
                        <td className="mono">{formatBRDia(p.data)}</td><td className="mono">{p.horario_inicio}–{p.horario_fim}</td><td>{p.tipo || "—"}</td><td className="mono">{formatBR(addDays(p.data, 6))}</td>
                        <td>{sol ? (
                          <>
                            <Pill status={sol.status}>{sol.status === "pendente" ? "Solicitada" : sol.status === "aprovada" ? "Aprovada" : "Rejeitada"}</Pill>
                            {sol.status === "rejeitada" && sol.motivo_rejeicao && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>Motivo: {sol.motivo_rejeicao}</div>}
                          </>
                        ) : <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>Não solicitada</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
