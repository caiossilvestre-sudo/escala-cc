import { useEffect, useState } from "react";
import { formatBR, weekdayAbbrev, daysInMonth, monthLabel, shiftMonth, eventoDoDia, mapaFeriadosPorData } from "../lib/helpers";

/** Select que também permite digitar um valor novo (ex: adicionar um setor ou uma escala que ainda não existe). */
export function EditableSelect({ value, onChange, options, placeholder = "Novo valor" }) {
  const [customMode, setCustomMode] = useState(!options.includes(value) && !!value);
  // Reavalia quando as opções terminam de carregar (evitam ficar "preso" em
  // modo texto livre se o valor já existir na lista, só chegou depois).
  useEffect(() => {
    if (options.includes(value)) setCustomMode(false);
  }, [options, value]);
  if (customMode) {
    return (
      <div style={{ display: "flex", gap: 4 }}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCustomMode(false); onChange(options[0] || ""); }} title="Voltar para a lista">✕</button>
      </div>
    );
  }
  return (
    <select value={value} onChange={(e) => { if (e.target.value === "__novo__") { setCustomMode(true); onChange(""); } else onChange(e.target.value); }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__novo__">+ Adicionar novo…</option>
    </select>
  );
}

export function Pill({ status, children }) {
  return <span className={`pill ${status}`}>{children}</span>;
}

export function TopBar({ title, subtitle, right }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div className="toast">{toast.msg}</div>;
}

export function Spinner({ label = "Carregando…" }) {
  return <div className="empty">{label}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="warn-box" style={{ background: "#FBE2E5", borderColor: "#F3C3CB", color: "#A32E42" }}>{error}</div>;
}

export function ShiftStrip({ colaboradorId, monthKey, plantoes, solicitacoes, atestados, ferias }) {
  const total = daysInMonth(monthKey);
  const colorFor = (status) => {
    if (status === "ferias") return "var(--ferias)";
    if (status === "folga_sindicato") return "var(--sindicato)";
    if (status === "folga_plantao") return "var(--folga)";
    if (status === "atestado") return "var(--atestado)";
    if (status === "plantao") return "var(--plantao)";
    return "var(--border)";
  };
  const days = Array.from({ length: total }, (_, i) => {
    const day = i + 1;
    const dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
    let status = "normal", label = "Sem registro";
    const plantao = plantoes.find((p) => p.colaborador_id === colaboradorId && p.data === dateStr);
    const feriasHit = ferias?.find((f) => f.colaborador_id === colaboradorId && f.status === "aprovada" && dateStr >= f.data_inicio && dateStr <= f.data_fim);
    const atestado = atestados.find((a) => a.colaborador_id === colaboradorId && dateStr >= a.data_inicio && dateStr <= a.data_fim);
    const folga = solicitacoes.find((s) => s.colaborador_id === colaboradorId && s.status === "aprovada" && s.data_solicitada === dateStr);
    if (plantao) { status = "plantao"; label = `Plantão ${plantao.horario_inicio}–${plantao.horario_fim}`; }
    else if (feriasHit) { status = "ferias"; label = "Férias"; }
    else if (atestado) { status = "atestado"; label = "Atestado"; }
    else if (folga) { status = folga.tipo; label = folga.tipo === "folga_sindicato" ? "Folga normal (sindicato)" : "Folga de plantão"; }
    return { day, dateStr, status, label };
  });
  return (
    <div>
      <div className="strip-header">{days.map((d) => <div key={`wd-${d.day}`} className="strip-header-cell">{weekdayAbbrev(d.dateStr)}</div>)}</div>
      <div className="strip-header" style={{ marginBottom: 3 }}>
        {days.map((d) => {
          const isDomingo = new Date(d.dateStr + "T00:00:00").getDay() === 0;
          return <div key={`dn-${d.day}`} className="strip-header-cell mono" style={{ fontWeight: isDomingo ? 700 : 500, color: isDomingo ? "var(--text)" : "var(--text-muted)" }}>{d.day}</div>;
        })}
      </div>
      <div className="strip">{days.map((d) => <div key={d.day} className="cell" title={`${formatBR(d.dateStr)} — ${d.label}`} style={{ background: colorFor(d.status) }} />)}</div>
    </div>
  );
}

/** Grade tipo planilha: colaboradores x dias do mês. */
export function CronogramaGrid({ colaboradores, plantoes, solicitacoes, atestados, ferias, feriados, mesFiltro, setMesFiltro, equipeFiltro, setEquipeFiltro, equipesOptions, showEquipeSelector }) {
  const colaboradoresById = Object.fromEntries(colaboradores.map((c) => [c.id, c]));
  const feriadosPorData = mapaFeriadosPorData(feriados);
  const lista = colaboradores.filter((c) => (!equipeFiltro || equipeFiltro === "Todas" ? true : c.equipe === equipeFiltro));
  const total = daysInMonth(mesFiltro);
  const dias = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {showEquipeSelector && (
          <select value={equipeFiltro} onChange={(e) => setEquipeFiltro(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }}>
            <option value="Todas">Todos os setores</option>
            {equipesOptions.map((e) => <option key={e}>{e}</option>)}
          </select>
        )}
        <button className="btn btn-ghost" onClick={() => setMesFiltro(shiftMonth(mesFiltro, -1))}>‹</button>
        <span className="mono" style={{ fontSize: 12.5, minWidth: 120, textAlign: "center" }}>{monthLabel(mesFiltro)}</span>
        <button className="btn btn-ghost" onClick={() => setMesFiltro(shiftMonth(mesFiltro, 1))}>›</button>
      </div>

      <div className="legend" style={{ marginBottom: 14 }}>
        <span className="item"><span className="sw" style={{ background: "#2F6FE8" }} />Plantão</span>
        <span className="item"><span className="sw" style={{ background: "#E8828A" }} />Folga (de plantão)</span>
        <span className="item"><span className="sw" style={{ background: "#A32E42" }} />Folga normal (sindicato)</span>
        <span className="item"><span className="sw" style={{ background: "#E8972E" }} />Atestado</span>
        <span className="item"><span className="sw" style={{ background: "#8A8F98" }} />Férias</span>
        <span className="item"><span className="sw" style={{ background: "#5B5F6B" }} />Feriado (sem plantão)</span>
      </div>

      <div className="cronograma-wrap">
        <table className="cronograma">
          <colgroup>
            <col style={{ width: 190 }} />
            {dias.map((d) => <col key={d} style={{ width: `calc((100% - 190px) / ${dias.length})` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="namecol">Nome</th>
              {dias.map((d) => {
                const dateStr = `${mesFiltro}-${String(d).padStart(2, "0")}`;
                const isDomingo = new Date(dateStr + "T00:00:00").getDay() === 0;
                const feriado = feriadosPorData[dateStr];
                return (
                  <th key={d} title={feriado ? `Feriado: ${feriado.nome}` : undefined} style={feriado ? { background: "#EEF0F3" } : isDomingo ? { background: "#F0F3FA" } : undefined}>
                    <div style={{ fontWeight: isDomingo || feriado ? 700 : 600, color: feriado ? "#5B5F6B" : isDomingo ? "var(--primary-ink)" : "var(--text-muted)" }}>{d}</div>
                    <div style={{ fontWeight: 400, fontSize: 9 }}>{weekdayAbbrev(dateStr)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={dias.length + 1} className="empty">Nenhum colaborador neste setor.</td></tr>}
            {lista.map((c) => (
              <tr key={c.id}>
                <td className="namecol">{c.nome}<span className="team">{c.equipe}</span></td>
                {dias.map((day) => {
                  const dateStr = `${mesFiltro}-${String(day).padStart(2, "0")}`;
                  const isDomingo = new Date(dateStr + "T00:00:00").getDay() === 0;
                  const feriado = feriadosPorData[dateStr];
                  const ev = eventoDoDia(c.id, dateStr, plantoes, solicitacoes, atestados, ferias, colaboradoresById, feriadosPorData);
                  return (
                    <td key={day} title={ev ? `${formatBR(dateStr)} — ${ev.title}` : feriado ? `${formatBR(dateStr)} — Feriado: ${feriado.nome}` : formatBR(dateStr)} style={feriado ? { background: "#F7F8FA" } : isDomingo ? { background: "#FAFBFF" } : undefined}>
                      {ev && <span className="badge-cell" style={{ background: ev.bg, color: ev.fg }}>{ev.label}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
