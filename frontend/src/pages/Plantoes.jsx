import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast, EditableSelect } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import {
  EQUIPES, TURNOS, todayISO, formatBR, formatBRDia, addDays, monthLabel, currentMonthKey,
  checarElegibilidade, ordenarPorJustica, contarPlantoesRecentes,
} from "../lib/helpers";

function TemplatesSection({ templates, onReload, showToast, equipeOptions, turnoOptions }) {
  const [form, setForm] = useState({ nome: "", equipe: equipeOptions[0] || EQUIPES[0], turno: turnoOptions[0] || TURNOS[0], horario_inicio: "08:00", horario_fim: "14:00" });
  const submit = async () => {
    if (!form.nome.trim()) return;
    try {
      await api.post("/plantao-templates", form);
      setForm({ ...form, nome: "" });
      onReload();
    } catch (e) { showToast(e.message); }
  };
  const remover = async (id) => {
    try { await api.delete(`/plantao-templates/${id}`); onReload(); } catch (e) { showToast(e.message); }
  };
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Horários de plantão disponíveis</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Cadastre os "slots" fixos de cobertura de domingo/feriado. A geração automática usa esses horários.</div>
      <div className="form-grid">
        <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex: Cobertura manhã N1" /></div>
        <div className="field"><label>Setor</label><EditableSelect value={form.equipe} onChange={(v) => setForm({ ...form, equipe: v })} options={equipeOptions} /></div>
        <div className="field"><label>Turno</label><EditableSelect value={form.turno} onChange={(v) => setForm({ ...form, turno: v })} options={turnoOptions} /></div>
        <div className="field"><label>Início</label><input type="time" value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></div>
        <div className="field"><label>Fim</label><input type="time" value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></div>
      </div>
      <button className="btn btn-primary" onClick={submit}>Adicionar horário</button>
      {templates.length > 0 && (
        <table className="tbl" style={{ marginTop: 14 }}>
          <thead><tr><th>Nome</th><th>Setor</th><th>Turno</th><th>Horário</th><th></th></tr></thead>
          <tbody>{templates.map((t) => (
            <tr key={t.id}><td>{t.nome}</td><td>{t.equipe}</td><td><Pill status="plantao">{t.turno}</Pill></td><td className="mono">{t.horario_inicio}–{t.horario_fim}</td><td><button className="btn btn-ghost btn-sm" onClick={() => remover(t.id)}>Remover</button></td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function GerarSection({ onGerado, showToast }) {
  const [mes, setMes] = useState(currentMonthKey());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await api.post("/plantoes/gerar", { mes });
      setResultado(r);
      showToast(`${r.novos.length} plantão(ões) sugerido(s) para ${monthLabel(mes)}.`);
      onGerado();
    } catch (e) { showToast(e.message); } finally { setGerando(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Gerar plantões de domingos e feriados</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Cria plantões sugeridos automaticamente para todos os domingos e feriados aplicáveis do mês, cruzando com os horários acima e priorizando quem tem menos plantões recentes.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field"><label>Mês</label><input type="month" value={mes} onChange={(e) => { setMes(e.target.value); setResultado(null); }} /></div>
        <button className="btn btn-primary" disabled={gerando} onClick={gerar}>{gerando ? "Gerando…" : "Gerar plantões sugeridos"}</button>
      </div>
      {resultado && (
        <div className="warn-box" style={{ marginTop: 12, background: resultado.pendencias.length ? "#FFF6E8" : "#EAF7EF", borderColor: resultado.pendencias.length ? "#F2D8A0" : "#BFE7CF", color: resultado.pendencias.length ? "#8A5E10" : "#177A50" }}>
          <span>
            {resultado.novos.length} plantão(ões) sugerido(s) — revise e confirme na tabela abaixo.
            {resultado.pendencias.length > 0 && ` ${resultado.pendencias.length} slot(s) sem colaborador elegível: ${resultado.pendencias.map((p) => `${formatBR(p.data)} (${p.template})`).join(", ")}.`}
          </span>
        </div>
      )}
    </div>
  );
}

function SugestaoManual({ colaboradores, plantoes, ferias, atestados, solicitacoes, onAtribuido, showToast, equipeOptions }) {
  const [criterio, setCriterio] = useState({ equipe: equipeOptions[0] || EQUIPES[0], data: todayISO(), horario_inicio: "08:00", horario_fim: "16:00", tipo: "Plantão manual" });
  const [buscou, setBuscou] = useState(false);
  const candidatos = colaboradores.filter((c) => c.role !== "admin");

  const resultados = candidatos.map((c) => ({ colaborador: c, ...checarElegibilidade(c, criterio, plantoes, ferias, atestados, solicitacoes) }));
  const elegiveis = ordenarPorJustica(resultados.filter((r) => r.elegivel), plantoes, criterio.data);
  const inelegiveis = resultados.filter((r) => !r.elegivel);

  const atribuir = async (colaboradorId) => {
    try {
      await api.post("/plantoes", { colaborador_id: colaboradorId, data: criterio.data, horario_inicio: criterio.horario_inicio, horario_fim: criterio.horario_fim, tipo: criterio.tipo });
      showToast("Plantão atribuído.");
      onAtribuido();
    } catch (e) { showToast(e.message); }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Sugestão manual de plantão</div>
      <div className="info-box">Verifica setor, conflito de horário e férias aprovadas — e ordena por justiça (menos plantões nos últimos 60 dias primeiro).</div>
      <div className="form-grid">
        <div className="field"><label>Setor</label><EditableSelect value={criterio.equipe} onChange={(v) => { setCriterio({ ...criterio, equipe: v }); setBuscou(false); }} options={equipeOptions} /></div>
        <div className="field"><label>Data</label><input type="date" value={criterio.data} onChange={(e) => { setCriterio({ ...criterio, data: e.target.value }); setBuscou(false); }} /></div>
        <div className="field"><label>Início</label><input type="time" value={criterio.horario_inicio} onChange={(e) => { setCriterio({ ...criterio, horario_inicio: e.target.value }); setBuscou(false); }} /></div>
        <div className="field"><label>Fim</label><input type="time" value={criterio.horario_fim} onChange={(e) => { setCriterio({ ...criterio, horario_fim: e.target.value }); setBuscou(false); }} /></div>
        <div className="field"><label>Tipo / observação</label><input value={criterio.tipo} onChange={(e) => setCriterio({ ...criterio, tipo: e.target.value })} /></div>
      </div>
      <button className="btn btn-primary" onClick={() => setBuscou(true)}>Buscar elegíveis</button>
      {buscou && (
        <div style={{ marginTop: 14 }}>
          {elegiveis.length === 0 ? <div className="empty">Ninguém elegível.</div> : (
            <table className="tbl" style={{ marginBottom: 12 }}>
              <thead><tr><th>Nome</th><th>Setor</th><th>Plantões (60d)</th><th></th></tr></thead>
              <tbody>{elegiveis.map((r) => (
                <tr key={r.colaborador.id}><td>{r.colaborador.nome}</td><td>{r.colaborador.equipe}</td><td className="mono">{contarPlantoesRecentes(r.colaborador.id, plantoes, criterio.data)}</td>
                  <td><button className="btn btn-success btn-sm" onClick={() => atribuir(r.colaborador.id)}>Atribuir</button></td></tr>
              ))}</tbody>
            </table>
          )}
          {inelegiveis.length > 0 && (
            <details><summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>Não elegíveis ({inelegiveis.length})</summary>
              <table className="tbl" style={{ marginTop: 8 }}><tbody>{inelegiveis.map((r) => <tr key={r.colaborador.id}><td>{r.colaborador.nome}</td><td style={{ color: "var(--text-muted)" }}>{r.motivos.join(" · ")}</td></tr>)}</tbody></table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function NovoPlantaoManualForm({ colaboradores, onCriado, showToast }) {
  const [data, setData] = useState(todayISO());
  const [setorFiltro, setSetorFiltro] = useState("Todos");
  const [linhas, setLinhas] = useState([{ colaborador_id: "", horario_inicio: "", horario_fim: "", tipo: "" }]);
  const [enviando, setEnviando] = useState(false);

  const candidatos = colaboradores.filter((c) => c.role !== "admin");
  const setoresDisponiveis = Array.from(new Set(candidatos.map((c) => c.equipe))).filter(Boolean);
  const candidatosFiltrados = setorFiltro === "Todos" ? candidatos : candidatos.filter((c) => c.equipe === setorFiltro);

  const atualizarLinha = (i, campo, valor) => {
    setLinhas((ls) => ls.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  };
  const adicionarLinha = () => setLinhas((ls) => [...ls, { colaborador_id: "", horario_inicio: "", horario_fim: "", tipo: "" }]);
  const removerLinha = (i) => setLinhas((ls) => ls.filter((_, idx) => idx !== i));

  const cadastrarTodos = async () => {
    const validas = linhas.filter((l) => l.colaborador_id && l.horario_inicio && l.horario_fim);
    if (validas.length === 0) { showToast("Preencha colaborador e horários em pelo menos uma linha."); return; }
    setEnviando(true);
    let sucesso = 0, falhas = 0;
    for (const l of validas) {
      try {
        await api.post("/plantoes", { colaborador_id: l.colaborador_id, data, horario_inicio: l.horario_inicio, horario_fim: l.horario_fim, tipo: l.tipo });
        sucesso++;
      } catch (e) {
        falhas++;
      }
    }
    setEnviando(false);
    showToast(falhas === 0 ? `${sucesso} plantão(ões) cadastrado(s).` : `${sucesso} cadastrado(s), ${falhas} falharam (conflito de horário ou fora do setor).`);
    if (sucesso > 0) {
      setLinhas([{ colaborador_id: "", horario_inicio: "", horario_fim: "", tipo: "" }]);
      onCriado();
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Novo plantão (manual)</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="field" style={{ maxWidth: 220 }}><label>Data (vale para todas as linhas abaixo)</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 220 }}><label>Filtrar setor (facilita achar quem procura)</label>
          <select value={setorFiltro} onChange={(e) => setSetorFiltro(e.target.value)}>
            <option value="Todos">Todos os setores</option>
            {setoresDisponiveis.map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
      </div>

      {linhas.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: i < linhas.length - 1 ? "1px dashed var(--border)" : "none" }}>
          <div className="field" style={{ minWidth: 160 }}><label>Colaborador</label>
            <select value={l.colaborador_id} onChange={(e) => atualizarLinha(i, "colaborador_id", e.target.value)}>
              <option value="">Selecione</option>{candidatosFiltrados.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 110 }}><label>Início</label><input type="time" value={l.horario_inicio} onChange={(e) => atualizarLinha(i, "horario_inicio", e.target.value)} /></div>
          <div className="field" style={{ minWidth: 110 }}><label>Fim</label><input type="time" value={l.horario_fim} onChange={(e) => atualizarLinha(i, "horario_fim", e.target.value)} /></div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}><label>Tipo / observação</label><input value={l.tipo} onChange={(e) => atualizarLinha(i, "tipo", e.target.value)} placeholder="ex: Plantão noturno" /></div>
          {linhas.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => removerLinha(i)} title="Remover esta linha">✕</button>}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" onClick={adicionarLinha}>+ Adicionar linha</button>
        <button className="btn btn-primary" disabled={enviando} onClick={cadastrarTodos}>{enviando ? "Cadastrando…" : `Cadastrar ${linhas.length > 1 ? `(${linhas.length} linhas)` : "plantão"}`}</button>
      </div>
    </div>
  );
}

export default function Plantoes() {
  const templates = useApiList("/plantao-templates");
  const plantoes = useApiList("/plantoes");
  const colaboradores = useApiList("/colaboradores");
  const ferias = useApiList("/ferias");
  const atestados = useApiList("/atestados");
  const solicitacoes = useApiList("/solicitacoes");
  const { toast, showToast } = useToast();
  const loading = templates.loading || plantoes.loading || colaboradores.loading;
  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";
  // Só mostra setor/turno que alguém do time (ou algum horário cadastrado)
  // realmente usa agora — some sozinho da lista quando ninguém mais usa.
  const equipeOptions = Array.from(new Set([...colaboradores.data.map((c) => c.equipe), ...templates.data.map((t) => t.equipe)])).filter(Boolean);
  const turnoOptions = Array.from(new Set([...colaboradores.data.map((c) => c.turno), ...templates.data.map((t) => t.turno)])).filter(Boolean);
  const confirmar = async (id) => { try { await api.post(`/plantoes/${id}/confirmar`); plantoes.reload(); } catch (e) { showToast(e.message); } };
  const reatribuir = async (id, novoId) => { try { await api.post(`/plantoes/${id}/reatribuir?novo_colaborador_id=${novoId}`); plantoes.reload(); showToast("Reatribuído."); } catch (e) { showToast(e.message); } };
  const remover = async (id) => {
    if (!window.confirm("Remover este plantão? Essa ação não pode ser desfeita.")) return;
    try {
      await api.delete(`/plantoes/${id}`);
      showToast("Plantão removido.");
      plantoes.reload();
    } catch (e) {
      showToast(e.message || "Não foi possível remover o plantão.");
    }
  };

  return (
    <>
      <TopBar title="Plantões" subtitle="Cada plantão tem horário próprio, diferente da escala padrão" />
      <div className="content">
        <ErrorBox error={templates.error || plantoes.error} />
        {loading ? <Spinner /> : (
          <>
            <TemplatesSection templates={templates.data} onReload={templates.reload} showToast={showToast} equipeOptions={equipeOptions} turnoOptions={turnoOptions} />
            <GerarSection onGerado={plantoes.reload} showToast={showToast} />
            <SugestaoManual colaboradores={colaboradores.data} plantoes={plantoes.data} ferias={ferias.data} atestados={atestados.data} solicitacoes={solicitacoes.data} onAtribuido={plantoes.reload} showToast={showToast} equipeOptions={equipeOptions} />

            <NovoPlantaoManualForm colaboradores={colaboradores.data} onCriado={plantoes.reload} showToast={showToast} />

            <div className="card">
              <div className="section-title">Todos os plantões ({plantoes.data.length})</div>
              {plantoes.data.length === 0 ? <div className="empty">Nenhum plantão cadastrado.</div> : (
                <table className="tbl">
                  <thead><tr><th>Colaborador</th><th>Data</th><th>Horário</th><th>Tipo</th><th>Prazo folga</th><th>Status</th><th></th></tr></thead>
                  <tbody>{[...plantoes.data].sort((a, b) => a.data.localeCompare(b.data)).map((p) => (
                    <tr key={p.id}>
                      <td>{p.sugerido ? (
                        <select value={p.colaborador_id} onChange={(e) => reatribuir(p.id, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 12 }}>
                          {colaboradores.data.filter((c) => c.role !== "admin").map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                      ) : nome(p.colaborador_id)}</td>
                      <td className="mono">{formatBRDia(p.data)}</td><td className="mono">{p.horario_inicio}–{p.horario_fim}</td><td>{p.tipo || "—"}</td>
                      <td className="mono">{formatBR(addDays(p.data, 6))}</td>
                      <td>{p.sugerido ? <Pill status="pendente">Sugerido</Pill> : <Pill status="aprovada">Confirmado</Pill>}</td>
                      <td style={{ display: "flex", gap: 6 }}>
                        {p.sugerido && <button className="btn btn-success btn-sm" onClick={() => confirmar(p.id)}>✓</button>}
                        <button className="btn btn-ghost btn-sm" onClick={() => remover(p.id)}>Remover</button>
                      </td>
                    </tr>
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
