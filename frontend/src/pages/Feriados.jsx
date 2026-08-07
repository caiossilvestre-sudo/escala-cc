import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { todayISO, formatBRDia } from "../lib/helpers";

export default function Feriados() {
  const { data, loading, error, reload } = useApiList("/feriados");
  const { toast, showToast } = useToast();
  const [form, setForm] = useState({ data: todayISO(), nome: "", tipo: "obrigatorio" });

  const submit = async () => {
    if (!form.data || !form.nome.trim()) return;
    try {
      await api.post("/feriados", form);
      setForm({ data: todayISO(), nome: "", tipo: "obrigatorio" });
      reload();
    } catch (e) { showToast(e.message); }
  };
  const alternar = async (id) => { try { await api.post(`/feriados/${id}/alternar-trabalha`); reload(); } catch (e) { showToast(e.message); } };
  const remover = async (id) => { try { await api.delete(`/feriados/${id}`); reload(); } catch (e) { showToast(e.message); } };

  const ordenados = [...data].sort((a, b) => a.data.localeCompare(b.data));

  return (
    <>
      <TopBar title="Feriados" subtitle="Obrigatórios sempre geram plantão · facultativos, você decide se a equipe trabalha" />
      <div className="content">
        <ErrorBox error={error} />
        <div className="info-box">Domingos não precisam ser cadastrados aqui: o sistema já considera todos automaticamente na geração de plantões.</div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Novo feriado</div>
          <div className="form-grid">
            <div className="field"><label>Data</label><input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
            <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex: Carnaval" /></div>
            <div className="field"><label>Tipo</label><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option value="obrigatorio">Obrigatório</option><option value="facultativo">Facultativo</option></select></div>
          </div>
          <button className="btn btn-primary" onClick={submit}>Cadastrar</button>
        </div>
        <div className="card">
          <div className="section-title">Feriados cadastrados ({ordenados.length})</div>
          {loading ? <Spinner /> : ordenados.length === 0 ? <div className="empty">Nenhum feriado cadastrado.</div> : (
            <table className="tbl">
              <thead><tr><th>Data</th><th>Nome</th><th>Tipo</th><th>Gera plantão?</th><th></th></tr></thead>
              <tbody>{ordenados.map((f) => (
                <tr key={f.id}>
                  <td className="mono">{formatBRDia(f.data)}</td><td>{f.nome}</td>
                  <td><Pill status={f.tipo === "obrigatorio" ? "plantao" : "pendente"}>{f.tipo === "obrigatorio" ? "Obrigatório" : "Facultativo"}</Pill></td>
                  <td>{f.tipo === "obrigatorio" ? <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Sempre</span> : (
                    <button className={`btn btn-sm ${f.trabalha ? "btn-success" : "btn-ghost"}`} onClick={() => alternar(f.id)}>{f.trabalha ? "Sim — equipe trabalha" : "Não — sem plantão"}</button>
                  )}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => remover(f.id)}>Remover</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
