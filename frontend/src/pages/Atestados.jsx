import { useState } from "react";
import { TopBar, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { todayISO, formatBRDia } from "../lib/helpers";

export function AtestadosAdmin() {
  const { data, loading, error, reload } = useApiList("/atestados");
  const colaboradores = useApiList("/colaboradores");
  const { toast, showToast } = useToast();
  const [form, setForm] = useState({ colaborador_id: "", data_inicio: todayISO(), data_fim: todayISO(), motivo: "" });

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";

  const submit = async () => {
    if (!form.colaborador_id || !form.motivo.trim()) { showToast("Preencha colaborador e motivo."); return; }
    try {
      await api.post("/atestados", form);
      setForm({ ...form, motivo: "" });
      reload();
      showToast("Atestado registrado.");
    } catch (e) { showToast(e.message); }
  };

  return (
    <>
      <TopBar title="Atestados" subtitle="Registro de afastamentos por atestado médico" />
      <div className="content">
        <ErrorBox error={error} />
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Registrar atestado</div>
          <div className="form-grid">
            <div className="field"><label>Colaborador</label><select value={form.colaborador_id} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value })}><option value="">Selecione</option>{colaboradores.data.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
            <div className="field"><label>Início</label><input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} /></div>
            <div className="field"><label>Fim</label><input type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} /></div>
            <div className="field"><label>Motivo</label><input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="ex: Consulta médica" /></div>
          </div>
          <button className="btn btn-primary" onClick={submit}>Registrar</button>
        </div>
        <div className="card">
          <div className="section-title">Todos os atestados ({data.length})</div>
          {loading ? <Spinner /> : data.length === 0 ? <div className="empty">Nenhum atestado registrado.</div> : (
            <table className="tbl">
              <thead><tr><th>Colaborador</th><th>Período</th><th>Motivo</th></tr></thead>
              <tbody>{data.map((a) => <tr key={a.id}><td>{nome(a.colaborador_id)}</td><td className="mono">{formatBRDia(a.data_inicio)} – {formatBRDia(a.data_fim)}</td><td>{a.motivo}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}

export default function MeusAtestados() {
  const { data, loading, error } = useApiList("/atestados");
  return (
    <>
      <TopBar title="Meus atestados" subtitle="Consulta — o registro é feito pelo administrador" />
      <div className="content">
        <ErrorBox error={error} />
        <div className="card">
          {loading ? <Spinner /> : data.length === 0 ? <div className="empty">Nenhum atestado registrado para você.</div> : (
            <table className="tbl">
              <thead><tr><th>Período</th><th>Motivo</th></tr></thead>
              <tbody>{data.map((a) => <tr key={a.id}><td className="mono">{formatBRDia(a.data_inicio)} – {formatBRDia(a.data_fim)}</td><td>{a.motivo}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
