import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox } from "../components/UI";
import { useApiList } from "../lib/hooks";
import { currentMonthKey, monthLabel, formatBRDia, TIPO_LABEL } from "../lib/helpers";

export default function Dashboard({ onNavigate }) {
  const [mes, setMes] = useState(currentMonthKey());
  const colaboradores = useApiList("/colaboradores");
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const atestados = useApiList("/atestados");
  const ferias = useApiList("/ferias");

  const loading = colaboradores.loading || plantoes.loading || solicitacoes.loading || atestados.loading || ferias.loading;
  const error = colaboradores.error || plantoes.error || solicitacoes.error || atestados.error || ferias.error;

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";
  const plantoesMes = plantoes.data.filter((p) => p.data.slice(0, 7) === mes);
  const atestadosMes = atestados.data.filter((a) => a.data_inicio.slice(0, 7) === mes || a.data_fim.slice(0, 7) === mes);
  const folgasMes = solicitacoes.data.filter((s) => s.status === "aprovada" && s.data_solicitada.slice(0, 7) === mes);
  const pendentes = solicitacoes.data.filter((s) => s.status === "pendente");
  const feriasPendentes = ferias.data.filter((f) => f.status === "solicitada" || f.status === "enviado_rh");

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Visão geral de ${monthLabel(mes)}`} right={<input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="mono" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} />} />
      <div className="content">
        <ErrorBox error={error} />
        {loading ? <Spinner /> : (
          <>
            <div className="grid-stats" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              <div className="card stat"><span className="dot" style={{ background: "var(--plantao)" }} /><div className="num">{plantoesMes.length}</div><div className="label">Plantões no mês</div></div>
              <div className="card stat"><span className="dot" style={{ background: "var(--folga)" }} /><div className="num">{folgasMes.length}</div><div className="label">Folgas aprovadas</div></div>
              <div className="card stat"><span className="dot" style={{ background: "var(--atestado)" }} /><div className="num">{atestadosMes.length}</div><div className="label">Atestados no mês</div></div>
              <button
                className="card stat"
                onClick={() => onNavigate && onNavigate("aprovacoes")}
                style={{ textAlign: "left", cursor: onNavigate ? "pointer" : "default", border: "1px solid var(--border)", background: "var(--surface)", fontFamily: "inherit" }}
                title="Ver solicitações de folga pendentes"
              >
                <span className="dot" style={{ background: "var(--pendente)" }} /><div className="num">{pendentes.length}</div><div className="label">Folgas pendentes {onNavigate && "→"}</div>
              </button>
              <button
                className="card stat"
                onClick={() => onNavigate && onNavigate("ferias")}
                style={{ textAlign: "left", cursor: onNavigate ? "pointer" : "default", border: "1px solid var(--border)", background: "var(--surface)", fontFamily: "inherit" }}
                title="Ver férias aguardando ação"
              >
                <span className="dot" style={{ background: "var(--ferias)" }} /><div className="num">{feriasPendentes.length}</div><div className="label">Férias aguardando ação {onNavigate && "→"}</div>
              </button>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Plantões do mês</div>
              {plantoesMes.length === 0 ? <div className="empty">Nenhum plantão cadastrado neste mês.</div> : (
                <table className="tbl">
                  <thead><tr><th>Colaborador</th><th>Data</th><th>Horário</th><th>Tipo</th></tr></thead>
                  <tbody>{[...plantoesMes].sort((a, b) => a.data.localeCompare(b.data)).map((p) => (
                    <tr key={p.id}><td>{nome(p.colaborador_id)}</td><td className="mono">{formatBRDia(p.data)}</td><td className="mono">{p.horario_inicio}–{p.horario_fim}</td><td>{p.tipo}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="card">
                <div className="section-title">Folgas aprovadas</div>
                {folgasMes.length === 0 ? <div className="empty">Nenhuma folga aprovada no período.</div> : (
                  <table className="tbl">
                    <thead><tr><th>Colaborador</th><th>Data</th><th>Tipo</th></tr></thead>
                    <tbody>{folgasMes.map((s) => (
                      <tr key={s.id}><td>{nome(s.colaborador_id)}</td><td className="mono">{formatBRDia(s.data_solicitada)}</td><td><Pill status={s.tipo === "folga_sindicato" ? "sindicato" : "aprovada"}>{TIPO_LABEL[s.tipo]}</Pill></td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              <div className="card">
                <div className="section-title">Atestados</div>
                {atestadosMes.length === 0 ? <div className="empty">Nenhum atestado no período.</div> : (
                  <table className="tbl">
                    <thead><tr><th>Colaborador</th><th>Período</th><th>Motivo</th></tr></thead>
                    <tbody>{atestadosMes.map((a) => (
                      <tr key={a.id}><td>{nome(a.colaborador_id)}</td><td className="mono">{formatBRDia(a.data_inicio)} – {formatBRDia(a.data_fim)}</td><td>{a.motivo}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
