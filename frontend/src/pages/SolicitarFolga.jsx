import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { addDays, formatBR, formatBRDia, TIPO_LABEL } from "../lib/helpers";

export default function SolicitarFolga({ user }) {
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const { toast, showToast } = useToast();

  const [tipo, setTipo] = useState("folga_plantao");
  const meusPlantoesSemFolga = plantoes.data.filter((p) => p.colaborador_id === user.colaborador_id && !solicitacoes.data.some((s) => s.plantao_id === p.id));
  const [plantaoId, setPlantaoId] = useState("");
  const [dataSolicitada, setDataSolicitada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [avisoConflito, setAvisoConflito] = useState(null);

  const plantaoSelecionado = plantoes.data.find((p) => p.id === plantaoId);
  const minData = plantaoSelecionado ? addDays(plantaoSelecionado.data, 1) : undefined;
  const maxData = plantaoSelecionado ? addDays(plantaoSelecionado.data, 6) : undefined;
  const podeEnviar = tipo === "folga_sindicato" ? !!dataSolicitada : (!!plantaoId && !!dataSolicitada);

  const enviar = async (ignorarAviso = false) => {
    setEnviando(true);
    try {
      await api.post("/solicitacoes", { tipo, plantao_id: tipo === "folga_plantao" ? plantaoId : null, data_solicitada: dataSolicitada, ignorar_aviso: ignorarAviso });
      showToast("Solicitação enviada para aprovação.");
      setDataSolicitada(""); setPlantaoId(""); setAvisoConflito(null);
      solicitacoes.reload();
    } catch (e) {
      if (e.message && e.message.includes("horário igual ou parecido")) {
        setAvisoConflito(e.message);
      } else {
        showToast(e.message || "Erro ao enviar solicitação.");
      }
    } finally {
      setEnviando(false);
    }
  };

  const minhas = solicitacoes.data.filter((s) => s.colaborador_id === user.colaborador_id).sort((a, b) => (b.id > a.id ? 1 : -1));

  return (
    <>
      <TopBar title="Solicitar folga" subtitle="Você escolhe a data — a aprovação final é do administrador" />
      <div className="content">
        <ErrorBox error={plantoes.error} />
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="form-grid">
            <div className="field">
              <label>Tipo de folga</label>
              <select value={tipo} onChange={(e) => { setTipo(e.target.value); setAvisoConflito(null); }}>
                <option value="folga_plantao">Folga de plantão</option>
                <option value="folga_sindicato">Folga normal (sindicato)</option>
              </select>
            </div>
            {tipo === "folga_plantao" && (
              <div className="field">
                <label>Plantão vinculado</label>
                <select value={plantaoId} onChange={(e) => { setPlantaoId(e.target.value); setDataSolicitada(""); setAvisoConflito(null); }}>
                  <option value="">Selecione</option>
                  {meusPlantoesSemFolga.map((p) => <option key={p.id} value={p.id}>{formatBR(p.data)} — {p.tipo || "Plantão"}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label>Data desejada {tipo === "folga_plantao" && "(até 6 dias após o plantão)"}</label>
              <input type="date" value={dataSolicitada} min={tipo === "folga_plantao" ? minData : undefined} max={tipo === "folga_plantao" ? maxData : undefined} onChange={(e) => { setDataSolicitada(e.target.value); setAvisoConflito(null); }} />
            </div>
          </div>

          {avisoConflito && (
            <div className="warn-box">
              <span>{avisoConflito} Se quiser mesmo assim, clique em "Enviar mesmo assim".</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={!podeEnviar || enviando} onClick={() => enviar(false)}>Enviar solicitação</button>
            {avisoConflito && <button className="btn btn-danger" disabled={enviando} onClick={() => enviar(true)}>Enviar mesmo assim</button>}
          </div>
          {tipo === "folga_plantao" && meusPlantoesSemFolga.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>Todos os seus plantões já têm uma folga solicitada ou aprovada.</div>
          )}
        </div>

        <div className="card">
          <div className="section-title">Minhas solicitações</div>
          {solicitacoes.loading ? <Spinner /> : minhas.length === 0 ? <div className="empty">Você ainda não fez nenhuma solicitação.</div> : (
            <table className="tbl">
              <thead><tr><th>Tipo</th><th>Data</th><th>Status</th><th>Motivo (se rejeitada)</th></tr></thead>
              <tbody>{minhas.map((s) => (
                <tr key={s.id}><td>{TIPO_LABEL[s.tipo]}</td><td className="mono">{formatBRDia(s.data_solicitada)}</td><td><Pill status={s.status}>{s.status === "pendente" ? "Pendente" : s.status === "aprovada" ? "Aprovada" : "Rejeitada"}</Pill></td><td style={{ color: "var(--danger)" }}>{s.status === "rejeitada" ? s.motivo_rejeicao || "—" : "—"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
