import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { todayISO, formatBR, formatBRDia, addDays, TIPO_LABEL } from "../lib/helpers";

export default function SolicitarFolga({ user }) {
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const cotas = useApiList("/solicitacoes/cotas-sindicato");
  const { toast, showToast } = useToast();

  const [tipo, setTipo] = useState("folga_plantao");
  const [plantaoId, setPlantaoId] = useState("");
  const [dataSindicato, setDataSindicato] = useState(todayISO());
  const [dataFolgaPlantao, setDataFolgaPlantao] = useState(todayISO());
  const [conflito, setConflito] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const minhas = solicitacoes.data.filter((s) => s.colaborador_id === user.colaborador_id);
  const meusPlantoes = plantoes.data.filter((p) => p.colaborador_id === user.colaborador_id);
  const plantoesSemFolga = meusPlantoes.filter((p) => !minhas.some((s) => s.plantao_id === p.id && s.status !== "rejeitada"));
  const plantaoEscolhido = meusPlantoes.find((p) => p.id === plantaoId);

  const enviar = async (ignorarAviso = false) => {
    setEnviando(true);
    setConflito(null);
    try {
      if (tipo === "folga_plantao") {
        if (!plantaoId) { showToast("Escolha o plantão."); setEnviando(false); return; }
        await api.post("/solicitacoes", { tipo: "folga_plantao", plantao_id: plantaoId, data_solicitada: dataFolgaPlantao, ignorar_aviso: ignorarAviso });
      } else {
        await api.post("/solicitacoes", { tipo: "folga_sindicato", data_solicitada: dataSindicato, ignorar_aviso: ignorarAviso });
      }
      showToast("Solicitação enviada — aguardando aprovação.");
      setPlantaoId("");
      solicitacoes.reload();
      cotas.reload();
    } catch (e) {
      const msg = e.message || "";
      if (msg.includes("horário igual ou parecido")) {
        setConflito(msg);
      } else {
        showToast(msg || "Erro ao solicitar.");
      }
    } finally {
      setEnviando(false);
    }
  };

  const loading = plantoes.loading || solicitacoes.loading || cotas.loading;

  return (
    <>
      <TopBar title="Solicitar folga" subtitle="Folga de plantão (vinculada a um plantão que você fez) ou folga normal do sindicato" />
      <div className="content">
        <ErrorBox error={plantoes.error || solicitacoes.error} />
        {loading ? <Spinner /> : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Nova solicitação</div>
              <div className="field" style={{ maxWidth: 280, marginBottom: 12 }}>
                <label>Tipo</label>
                <select value={tipo} onChange={(e) => { setTipo(e.target.value); setConflito(null); }}>
                  <option value="folga_plantao">Folga de plantão</option>
                  <option value="folga_sindicato">Folga normal (sindicato)</option>
                </select>
              </div>

              {tipo === "folga_plantao" ? (
                <>
                  {plantoesSemFolga.length === 0 ? (
                    <div className="empty">Você não tem nenhum plantão sem folga já solicitada.</div>
                  ) : (
                    <>
                      <div className="field" style={{ maxWidth: 340, marginBottom: 10 }}>
                        <label>Plantão</label>
                        <select value={plantaoId} onChange={(e) => setPlantaoId(e.target.value)}>
                          <option value="">Selecione</option>
                          {plantoesSemFolga.map((p) => <option key={p.id} value={p.id}>{formatBRDia(p.data)} — {p.horario_inicio}-{p.horario_fim}</option>)}
                        </select>
                      </div>
                      {plantaoEscolhido && (
                        <div className="info-box">
                          Prazo pra agendar essa folga: até {formatBR(addDays(plantaoEscolhido.data, 6))} (ou mais, se o plantão foi num feriado — o sistema confere isso automaticamente). Domingo e feriado não valem como data de folga.
                        </div>
                      )}
                      <div className="field" style={{ maxWidth: 220, marginBottom: 12 }}>
                        <label>Data da folga</label>
                        <input type="date" value={dataFolgaPlantao} min={plantaoEscolhido ? addDays(plantaoEscolhido.data, 1) : undefined} onChange={(e) => setDataFolgaPlantao(e.target.value)} />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  {cotas.data && (
                    <div className="info-box">
                      Ciclo {cotas.data.ciclo}: você já usou <b>{cotas.data.total_usadas} de {cotas.data.total_disponivel}</b> folgas sindicato.
                      {" "}{cotas.data.cotas?.map((c) => `${c.nome}${c.usada ? " ✓" : ""}`).join(" · ")}
                    </div>
                  )}
                  <div className="field" style={{ maxWidth: 220, marginBottom: 12 }}>
                    <label>Data da folga</label>
                    <input type="date" value={dataSindicato} onChange={(e) => setDataSindicato(e.target.value)} />
                  </div>
                </>
              )}

              {conflito && (
                <div className="warn-box">
                  <span>{conflito}</span>
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => enviar(true)}>Enviar mesmo assim</button>
                </div>
              )}

              <button className="btn btn-primary" disabled={enviando} onClick={() => enviar(false)}>Enviar solicitação</button>
            </div>

            <div className="card">
              <div className="section-title">Minhas solicitações</div>
              {minhas.length === 0 ? <div className="empty">Você ainda não solicitou nenhuma folga.</div> : (
                <table className="tbl">
                  <thead><tr><th>Tipo</th><th>Data</th><th>Status</th><th>Motivo (se rejeitada)</th></tr></thead>
                  <tbody>{[...minhas].sort((a, b) => b.data_solicitada.localeCompare(a.data_solicitada)).map((s) => (
                    <tr key={s.id}>
                      <td>{TIPO_LABEL[s.tipo]}</td>
                      <td className="mono">{formatBRDia(s.data_solicitada)}</td>
                      <td><Pill status={s.status}>{s.status === "aprovada" ? "Aprovada" : s.status === "pendente" ? "Pendente" : "Rejeitada"}</Pill></td>
                      <td style={{ color: "var(--text-muted)" }}>{s.motivo_rejeicao || "—"}</td>
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
