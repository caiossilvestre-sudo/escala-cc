import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox } from "../components/UI";
import { useApiList } from "../lib/hooks";
import { currentMonthKey, monthLabel, formatBR, formatBRDia, todayISO, addDays, rangeOverlapsDate, TIPO_LABEL } from "../lib/helpers";

/** Compara horário atual contra um intervalo, cobrindo turnos que cruzam a
 * meia-noite (ex: 19:00–07:00, comum no 12x36 do Monitoramento). */
function estaNoHorario(horaAtual, inicio, fim) {
  if (inicio <= fim) return horaAtual >= inicio && horaAtual <= fim;
  return horaAtual >= inicio || horaAtual <= fim; // turno vira a noite
}

function EmExpedienteAgora({ colaboradores, plantoes, solicitacoes, atestados, ferias, feriados }) {
  const hoje = todayISO();
  const agora = new Date();
  const horaAtual = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  const diaSemana = agora.getDay(); // 0 = domingo
  const feriadoHoje = feriados.find((f) => f.data === hoje && (f.tipo === "obrigatorio" || f.trabalha));
  const diaEspecial = diaSemana === 0 || !!feriadoHoje;

  const ontem = addDays(hoje, -1);

  const lista = [];
  for (const c of colaboradores) {
    if (c.role === "admin") continue;

    // 1) Plantão real cadastrado pra hoje sempre tem prioridade — cobre
    // domingo, feriado, plantão manual e também o 12x36 já gerado. Também
    // olha o plantão de ONTEM se ele cruza a meia-noite e ainda está em
    // andamento de madrugada (turno 19h–07h iniciado ontem, por exemplo).
    const plantaoHoje = plantoes.find((p) => p.colaborador_id === c.id && p.data === hoje);
    const plantaoOntem = plantoes.find((p) => p.colaborador_id === c.id && p.data === ontem && p.horario_fim < p.horario_inicio);

    if (plantaoHoje && estaNoHorario(horaAtual, plantaoHoje.horario_inicio, plantaoHoje.horario_fim)) {
      lista.push({ colaborador: c, inicio: plantaoHoje.horario_inicio, fim: plantaoHoje.horario_fim, tipo: `Plantão — ${plantaoHoje.tipo || ""}` });
      continue;
    }
    if (plantaoOntem && horaAtual <= plantaoOntem.horario_fim) {
      lista.push({ colaborador: c, inicio: plantaoOntem.horario_inicio, fim: plantaoOntem.horario_fim, tipo: `Plantão — ${plantaoOntem.tipo || ""} (madrugada)` });
      continue;
    }
    if (plantaoHoje) {
      const cruzaHoje = plantaoHoje.horario_fim < plantaoHoje.horario_inicio;
      // Se cruza a meia-noite, "hoje" só conta a partir do início (a
      // madrugada pertence ao turno de ONTEM, já tratado acima) — senão a
      // mesma janela de horário seria contada duas vezes, num dia e no outro.
      const dentro = cruzaHoje ? horaAtual >= plantaoHoje.horario_inicio : estaNoHorario(horaAtual, plantaoHoje.horario_inicio, plantaoHoje.horario_fim);
      if (dentro) {
        lista.push({ colaborador: c, inicio: plantaoHoje.horario_inicio, fim: plantaoHoje.horario_fim, tipo: `Plantão — ${plantaoHoje.tipo || ""}` });
      }
      continue;
    }

    // 2) Ciclo 12x36 (Monitoramento) sem plantão gerado ainda pro dia: calcula
    // pela própria conta do ciclo, sem depender de já ter rodado "Gerar
    // plantões 12x36" — e feriado não muda nada pra essa equipe. Também
    // confere se o turno de ONTEM (se cruza a meia-noite) ainda está rolando.
    const ehMonitoramento12x36 = c.equipe === "Monitoramento" && c.escala_tipo === "12x36" && c.ciclo_12x36_inicio;
    if (ehMonitoramento12x36) {
      const turnoCruzaMeiaNoite = c.horario_fim < c.horario_inicio;
      if (turnoCruzaMeiaNoite && horaAtual <= c.horario_fim && ontem >= c.ciclo_12x36_inicio) {
        const diasDesdeInicioOntem = Math.round((new Date(ontem + "T00:00:00") - new Date(c.ciclo_12x36_inicio + "T00:00:00")) / 86400000);
        if (diasDesdeInicioOntem % 2 === 0) {
          lista.push({ colaborador: c, inicio: c.horario_inicio, fim: c.horario_fim, tipo: `${c.equipe} (madrugada)` });
          continue;
        }
      }
      if (hoje >= c.ciclo_12x36_inicio) {
        const diasDesdeInicio = Math.round((new Date(hoje + "T00:00:00") - new Date(c.ciclo_12x36_inicio + "T00:00:00")) / 86400000);
        const dentroHoje = turnoCruzaMeiaNoite ? horaAtual >= c.horario_inicio : estaNoHorario(horaAtual, c.horario_inicio, c.horario_fim);
        if (diasDesdeInicio % 2 === 0 && dentroHoje) {
          lista.push({ colaborador: c, inicio: c.horario_inicio, fim: c.horario_fim, tipo: c.equipe });
        }
      }
      continue;
    }

    // 3) Escala normal (segunda a sábado) — domingo e feriado só valem por
    // plantão mesmo, já tratado acima.
    if (diaEspecial) continue;
    if (!estaNoHorario(horaAtual, c.horario_inicio, c.horario_fim)) continue;
    const temFolga = solicitacoes.some((s) => s.colaborador_id === c.id && s.status === "aprovada" && s.data_solicitada === hoje);
    const temAtestado = atestados.some((a) => a.colaborador_id === c.id && rangeOverlapsDate(hoje, a.data_inicio, a.data_fim));
    const temFerias = ferias.some((f) => f.colaborador_id === c.id && f.status === "aprovada" && rangeOverlapsDate(hoje, f.data_inicio, f.data_fim));
    if (temFolga || temAtestado || temFerias) continue;
    lista.push({ colaborador: c, inicio: c.horario_inicio, fim: c.horario_fim, tipo: c.equipe });
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">
        Quem está em expediente agora
        <span className="mono" style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" }}>{horaAtual}</span>
      </div>
      {diaEspecial && (
        <div className="info-box">
          {feriadoHoje ? `Hoje é feriado (${feriadoHoje.nome})` : "Hoje é domingo"} — só quem está de plantão (ou no ciclo 12x36) aparece aqui, expediente normal não se aplica.
        </div>
      )}
      {lista.length === 0 ? (
        <div className="empty">{diaEspecial ? "Ninguém de plantão agora." : "Ninguém em expediente neste horário."}</div>
      ) : (
        <table className="tbl">
          <thead><tr><th>Nome</th><th>Setor</th><th>Horário</th></tr></thead>
          <tbody>{lista.map((x) => (
            <tr key={x.colaborador.id}>
              <td>{x.colaborador.nome}</td>
              <td><Pill status="plantao">{x.tipo}</Pill></td>
              <td className="mono">{x.inicio}–{x.fim}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Dashboard({ onNavigate }) {
  const [mes, setMes] = useState(currentMonthKey());
  const [equipeFiltro, setEquipeFiltro] = useState("Todas");
  const colaboradores = useApiList("/colaboradores");
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const atestados = useApiList("/atestados");
  const ferias = useApiList("/ferias");
  const feriados = useApiList("/feriados");

  const loading = colaboradores.loading || plantoes.loading || solicitacoes.loading || atestados.loading || ferias.loading || feriados.loading;
  const error = colaboradores.error || plantoes.error || solicitacoes.error || atestados.error || ferias.error || feriados.error;

  const equipesDisponiveis = Array.from(new Set(colaboradores.data.filter((c) => c.role === "colaborador" || c.role === "supervisor").map((c) => c.equipe))).filter(Boolean);
  const colaboradorPorId = Object.fromEntries(colaboradores.data.map((c) => [c.id, c]));
  const nome = (id) => colaboradorPorId[id]?.nome || "—";
  const equipeDe = (id) => colaboradorPorId[id]?.equipe || "—";
  const noFiltro = (colaboradorId) => equipeFiltro === "Todas" || equipeDe(colaboradorId) === equipeFiltro;

  const colaboradoresFiltrados = equipeFiltro === "Todas" ? colaboradores.data : colaboradores.data.filter((c) => c.equipe === equipeFiltro);
  const plantoesMes = plantoes.data.filter((p) => p.data.slice(0, 7) === mes && noFiltro(p.colaborador_id));
  const atestadosMes = atestados.data.filter((a) => (a.data_inicio.slice(0, 7) === mes || a.data_fim.slice(0, 7) === mes) && noFiltro(a.colaborador_id));
  const folgasMes = solicitacoes.data.filter((s) => s.status === "aprovada" && s.data_solicitada.slice(0, 7) === mes && noFiltro(s.colaborador_id));
  const pendentes = solicitacoes.data.filter((s) => s.status === "pendente" && noFiltro(s.colaborador_id));
  const feriasPendentes = ferias.data.filter((f) => (f.status === "solicitada" || f.status === "enviado_rh") && noFiltro(f.colaborador_id));

  const hoje = todayISO();
  const statusFolgaDoPlantao = (p) => {
    const solicitacao = solicitacoes.data.find((s) => s.plantao_id === p.id && s.status !== "rejeitada");
    if (solicitacao) return { label: solicitacao.status === "aprovada" ? "Folga aprovada" : "Folga pendente", cor: "aprovada" };
    const prazo = addDays(p.data, 6);
    if (hoje > prazo) return { label: "Atrasado — sem folga", cor: "rejeitada" };
    return { label: `Agendar até ${formatBR(prazo)}`, cor: "pendente" };
  };

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Visão geral de ${monthLabel(mes)}`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <select value={equipeFiltro} onChange={(e) => setEquipeFiltro(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }}>
              <option value="Todas">Todos os setores</option>
              {equipesDisponiveis.map((e) => <option key={e}>{e}</option>)}
            </select>
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="mono" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} />
          </div>
        } />
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

            <EmExpedienteAgora colaboradores={colaboradoresFiltrados} plantoes={plantoes.data} solicitacoes={solicitacoes.data} atestados={atestados.data} ferias={ferias.data} feriados={feriados.data} />

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Plantões do mês</div>
              {plantoesMes.length === 0 ? <div className="empty">Nenhum plantão cadastrado neste mês.</div> : (
                <table className="tbl">
                  <thead><tr><th>Colaborador</th><th>Setor</th><th>Data</th><th>Horário</th><th>Tipo</th><th>Folga do plantão</th></tr></thead>
                  <tbody>{[...plantoesMes].sort((a, b) => a.data.localeCompare(b.data)).map((p) => {
                    const st = statusFolgaDoPlantao(p);
                    return (
                      <tr key={p.id}>
                        <td>{nome(p.colaborador_id)}</td>
                        <td><Pill status="plantao">{equipeDe(p.colaborador_id)}</Pill></td>
                        <td className="mono">{formatBRDia(p.data)}</td><td className="mono">{p.horario_inicio}–{p.horario_fim}</td><td>{p.tipo}</td>
                        <td><Pill status={st.cor}>{st.label}</Pill></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="card">
                <div className="section-title">Folgas aprovadas</div>
                {folgasMes.length === 0 ? <div className="empty">Nenhuma folga aprovada no período.</div> : (
                  <table className="tbl">
                    <thead><tr><th>Colaborador</th><th>Setor</th><th>Data</th><th>Tipo</th></tr></thead>
                    <tbody>{folgasMes.map((s) => (
                      <tr key={s.id}><td>{nome(s.colaborador_id)}</td><td><Pill status="plantao">{equipeDe(s.colaborador_id)}</Pill></td><td className="mono">{formatBRDia(s.data_solicitada)}</td><td><Pill status={s.tipo === "folga_sindicato" ? "sindicato" : "aprovada"}>{TIPO_LABEL[s.tipo]}</Pill></td></tr>
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
