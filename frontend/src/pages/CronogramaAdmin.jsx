import { useState } from "react";
import { TopBar, Spinner, ErrorBox, Toast } from "../components/UI";
import { CronogramaGrid } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { currentMonthKey, todayISO } from "../lib/helpers";

function NovaAusenciaForm({ colaboradores, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    colaborador_id: colaboradores[0]?.id || "", tipo: "folga_sindicato",
    data_inicio: todayISO(), data_fim: todayISO(), data_plantao: todayISO(), motivo: "",
  });
  return (
    <div className="card" style={{ marginBottom: 16, borderColor: "var(--primary)" }}>
      <div className="section-title">Registrar ausência diretamente</div>
      <div className="form-grid">
        <div className="field"><label>Colaborador</label>
          <select value={form.colaborador_id} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value })}>
            {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="field"><label>Tipo</label>
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            <option value="folga_sindicato">Folga normal (sindicato)</option>
            <option value="folga_plantao">Folga de plantão</option>
            <option value="atestado">Atestado</option>
            <option value="ferias">Férias</option>
          </select>
        </div>
        {form.tipo === "folga_plantao" ? (
          <>
            <div className="field"><label>Data da folga (que já foi tirada)</label><input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} /></div>
            <div className="field"><label>Data em que o plantão foi realizado</label><input type="date" value={form.data_plantao} onChange={(e) => setForm({ ...form, data_plantao: e.target.value })} /></div>
          </>
        ) : (
          <div className="field"><label>{form.tipo === "atestado" || form.tipo === "ferias" ? "Início" : "Data"}</label>
            <input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value, data_fim: e.target.value > form.data_fim ? e.target.value : form.data_fim })} />
          </div>
        )}
        {(form.tipo === "atestado" || form.tipo === "ferias") && (
          <div className="field"><label>Fim</label><input type="date" value={form.data_fim} min={form.data_inicio} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} /></div>
        )}
        {form.tipo === "atestado" && (
          <div className="field"><label>Motivo</label><input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="ex: Consulta médica" /></div>
        )}
      </div>
      {form.tipo === "folga_plantao" && (
        <div className="info-box">Isso liga a folga ao plantão daquele dia — se não achar um plantão dessa pessoa nessa data, vai dar erro. Prazo e dia útil (sem domingo/feriado) são conferidos automaticamente.</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" onClick={() => onSubmit(form)}>Registrar</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

export default function CronogramaAdmin() {
  const [mes, setMes] = useState(currentMonthKey());
  const [equipe, setEquipe] = useState("Todas");
  const [showForm, setShowForm] = useState(false);
  const colaboradores = useApiList("/colaboradores");
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const atestados = useApiList("/atestados");
  const ferias = useApiList("/ferias");
  const feriados = useApiList("/feriados");
  const { toast, showToast } = useToast();

  const loading = colaboradores.loading || plantoes.loading || solicitacoes.loading || atestados.loading || ferias.loading || feriados.loading;
  const error = colaboradores.error || plantoes.error || solicitacoes.error || atestados.error || ferias.error || feriados.error;

  // Só considera "setor de verdade" quem tem pelo menos um colaborador comum
  // nele — assim o setor "casa" de um admin/supervisor/visualizador (que é só
  // um rótulo de perfil) não aparece nos filtros como se fosse um time real.
  const equipesOperacionais = Array.from(new Set(colaboradores.data.filter((c) => c.role === "colaborador" || c.role === "supervisor").map((c) => c.equipe))).filter(Boolean);

  const registrarAusencia = async (form) => {
    try {
      if (form.tipo === "atestado") {
        await api.post("/atestados", { colaborador_id: form.colaborador_id, data_inicio: form.data_inicio, data_fim: form.data_fim, motivo: form.motivo || "—" });
        await atestados.reload();
      } else if (form.tipo === "ferias") {
        showToast("Para férias, use a aba Férias — lá o fluxo de 3 etapas já cobre o registro direto.");
        setShowForm(false);
        return;
      } else if (form.tipo === "folga_plantao") {
        await api.post("/solicitacoes", { tipo: "folga_plantao", colaborador_id: form.colaborador_id, data_solicitada: form.data_inicio, data_plantao: form.data_plantao, ignorar_aviso: true });
        await solicitacoes.reload();
      } else {
        await api.post("/solicitacoes", { tipo: form.tipo, colaborador_id: form.colaborador_id, data_solicitada: form.data_inicio, ignorar_aviso: true });
        await solicitacoes.reload();
      }
      showToast("Registrado com sucesso.");
      setShowForm(false);
    } catch (e) {
      showToast(e.message || "Erro ao registrar.");
    }
  };

  return (
    <>
      <TopBar title="Cronograma" subtitle="Visão mensal por colaborador — plantões, folgas, atestados e férias"
        right={<button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>Nova ausência</button>} />
      <div className="content content-wide">
        <ErrorBox error={error} />
        {loading ? <Spinner /> : (
          <>
            {showForm && <NovaAusenciaForm colaboradores={colaboradores.data.filter((c) => c.role !== "admin")} onSubmit={registrarAusencia} onCancel={() => setShowForm(false)} />}
            <CronogramaGrid
              colaboradores={colaboradores.data.filter((c) => c.role !== "admin")} plantoes={plantoes.data} solicitacoes={solicitacoes.data}
              atestados={atestados.data} ferias={ferias.data} feriados={feriados.data}
              mesFiltro={mes} setMesFiltro={setMes} equipeFiltro={equipe} setEquipeFiltro={setEquipe}
              equipesOptions={equipesOperacionais} showEquipeSelector
            />
          </>
        )}
      </div>
      <Toast toast={toast} />
    </>
  );
}
