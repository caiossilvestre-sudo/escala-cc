import { useState } from "react";
import { TopBar, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { todayISO, formatBR } from "../lib/helpers";

const TIPO_LABEL = { mensal: "Lista mensal (dia 1º)", semanal: "Aviso semanal (segunda)", cobranca: "Cobrança de folga" };

export function AvisosAdmin() {
  const { data, loading, error, reload } = useApiList("/avisos");
  const colaboradores = useApiList("/colaboradores");
  const { toast, showToast } = useToast();
  const [simDate, setSimDate] = useState(todayISO());
  const [gerando, setGerando] = useState(false);

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await api.post(`/avisos/gerar?data_ref=${simDate}`);
      showToast(r.gerados > 0 ? `${r.gerados} aviso(s) gerado(s).` : "Nenhum aviso novo para esta data.");
      reload();
    } catch (e) { showToast(e.message); } finally { setGerando(false); }
  };

  return (
    <>
      <TopBar title="Avisos" subtitle="Verificação diária: lista mensal, aviso semanal e cobrança de folga"
        right={<div style={{ display: "flex", gap: 8 }}><input type="date" value={simDate} onChange={(e) => setSimDate(e.target.value)} className="mono" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} /><button className="btn btn-primary" disabled={gerando} onClick={gerar}>Rodar verificação</button></div>} />
      <div className="content">
        <ErrorBox error={error} />
        <div className="info-box">
          Regras: todo dia 1º gera a lista de plantões do mês · toda segunda-feira avisa quem tem plantão naquela semana · 6 dias após o plantão sem folga solicitada, dispara cobrança. Nesta fase (MVP1), os avisos ficam só no painel do sistema — e-mail e Teams entram numa fase seguinte. Em produção, chame esta rota automaticamente uma vez por dia (ex: GitHub Actions agendado).
        </div>
        <div className="card">
          <div className="section-title">Avisos gerados ({data.length})</div>
          {loading ? <Spinner /> : data.length === 0 ? <div className="empty">Nenhum aviso gerado ainda.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.map((a) => (
                <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <b style={{ fontSize: 12.5 }}>{nome(a.colaborador_id)} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {TIPO_LABEL[a.tipo]}</span></b>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatBR(a.data)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{a.mensagem}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}

export default function PainelAvisos() {
  const { data, loading, error, setData } = useApiList("/avisos");
  const marcarLido = async (id) => {
    try { await api.post(`/avisos/${id}/marcar-lido`); setData((list) => list.map((a) => (a.id === id ? { ...a, lido: true } : a))); } catch (e) { /* ignore */ }
  };
  const ordenados = [...data].sort((a, b) => b.data.localeCompare(a.data));
  return (
    <>
      <TopBar title="Painel de avisos" subtitle="Avisos sobre seus plantões e prazos de folga" />
      <div className="content">
        <ErrorBox error={error} />
        {loading ? <Spinner /> : ordenados.length === 0 ? <div className="card empty">Nenhum aviso por aqui ainda.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ordenados.map((a) => (
              <div key={a.id} className="card" style={{ borderColor: a.lido ? "var(--border)" : "var(--primary)", background: a.lido ? "var(--surface)" : "#FFF7F0" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <b style={{ fontSize: 12.5 }}>{TIPO_LABEL[a.tipo]}</b>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatBR(a.data)}</span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 5 }}>{a.mensagem}</div>
                {!a.lido && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => marcarLido(a.id)}>Marcar como lido</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
