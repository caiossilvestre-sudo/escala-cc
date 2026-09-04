import { useEffect, useState } from "react";
import { TopBar, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { todayISO, formatBR } from "../lib/helpers";

const TIPO_LABEL = { mensal: "Lista mensal (dia 1º)", semanal: "Aviso semanal (segunda)", cobranca: "Cobrança de folga", aniversario: "Aniversário", aniversario_trabalho: "Aniversário de empresa" };
const VIA_LABEL = { manual: "clicou em marcar como lido", automatico: "visto 3x sem ação (marcado sozinho)" };

function formatarDataHora(iso) {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MensagemEditavel({ chave, titulo, variaveis, showToast }) {
  const [valor, setValor] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get(`/configuracoes/${chave}`).then((r) => setValor(r.valor)).catch(() => {}).finally(() => setCarregando(false));
  }, [chave]);

  const salvar = async () => {
    if (!valor.trim()) { showToast("A mensagem não pode ficar vazia."); return; }
    setSalvando(true);
    try {
      await api.patch(`/configuracoes/${chave}`, { valor });
      showToast("Mensagem salva.");
    } catch (e) {
      showToast(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>{titulo}</label>
      {carregando ? <Spinner label="Carregando mensagem…" /> : (
        <>
          <textarea rows={2} value={valor} onChange={(e) => setValor(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 9, fontSize: 12.5, fontFamily: "inherit" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Variáveis disponíveis: {variaveis.map((v) => <code key={v} className="mono" style={{ background: "#F0F1F4", padding: "1px 5px", borderRadius: 4, marginRight: 4 }}>{v}</code>)}</span>
            <button className="btn btn-primary btn-sm" disabled={salvando} onClick={salvar}>Salvar</button>
          </div>
        </>
      )}
    </div>
  );
}

export function AvisosAdmin() {
  const { data, loading, error, reload } = useApiList("/avisos");
  const colaboradores = useApiList("/colaboradores");
  const { toast, showToast } = useToast();
  const [simDate, setSimDate] = useState(todayISO());
  const [forcar, setForcar] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [somenteNaoLidos, setSomenteNaoLidos] = useState(false);

  const nome = (id) => colaboradores.data.find((c) => c.id === id)?.nome || "—";
  const lidos = data.filter((a) => a.lido).length;
  const naoLidos = data.length - lidos;
  const listaExibida = somenteNaoLidos ? data.filter((a) => !a.lido) : data;

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await api.post(`/avisos/gerar?data_ref=${simDate}&forcar=${forcar}`);
      showToast(r.gerados > 0 ? `${r.gerados} aviso(s) gerado(s).` : "Nenhum aviso novo para esta data (tente marcar 'Forçar reenvio' se quiser reenviar mesmo já tendo sido avisado).");
      reload();
    } catch (e) { showToast(e.message); } finally { setGerando(false); }
  };

  return (
    <>
      <TopBar title="Avisos" subtitle="Verificação diária: lista mensal, aviso semanal, cobrança de folga, aniversário e tempo de casa"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={simDate} onChange={(e) => setSimDate(e.target.value)} className="mono" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} />
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} /> Forçar reenvio
            </label>
            <button className="btn btn-primary" disabled={gerando} onClick={gerar}>Rodar verificação</button>
          </div>
        } />
      <div className="content">
        <ErrorBox error={error} />
        <div className="info-box">
          Regras: todo dia 1º gera a lista de plantões do mês · toda segunda-feira avisa quem tem plantão naquela semana · 6 dias após o plantão (ou domingo da semana seguinte, se foi em feriado) sem folga solicitada, dispara cobrança · aniversário e tempo de casa disparam mensagem automática no dia certo. Cada aviso aparece pra pessoa assim que ela loga — se ela não marcar como lido, ele conta como "mostrado"; depois de aparecer 3 vezes sem ação, o sistema considera lido sozinho pra não incomodar. Cada pessoa só vê e só marca como lido os próprios avisos — mesmo o admin, aqui nesta tela, só está consultando, não interfere no que já foi mostrado pra ninguém.
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Mensagens automáticas (editáveis)</div>
          <MensagemEditavel chave="mensagem_aniversario" titulo="Aniversário (nascimento)" variaveis={["{nome}"]} showToast={showToast} />
          <MensagemEditavel chave="mensagem_aniversario_trabalho" titulo="Aniversário de empresa (tempo de casa)" variaveis={["{nome}", "{anos}"]} showToast={showToast} />
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>
              Avisos gerados ({data.length}) — <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{lidos} lidos, {naoLidos} não lidos</span>
            </div>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={somenteNaoLidos} onChange={(e) => setSomenteNaoLidos(e.target.checked)} /> Mostrar só não lidos
            </label>
          </div>
          {loading ? <Spinner /> : listaExibida.length === 0 ? <div className="empty">{somenteNaoLidos ? "Nenhum aviso não lido." : "Nenhum aviso gerado ainda."}</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...listaExibida].sort((a, b) => b.data.localeCompare(a.data)).map((a) => (
                <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: a.lido ? "var(--surface)" : "#FFF7F0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                    <b style={{ fontSize: 12.5 }}>{nome(a.colaborador_id)} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {TIPO_LABEL[a.tipo] || a.tipo}</span></b>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={`pill ${a.lido ? "aprovada" : "pendente"}`}>{a.lido ? "Lido" : "Não lido"}</span>
                      {!a.lido && <span className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>mostrado {a.vezes_mostrado || 0}/3x</span>}
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatBR(a.data)}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-line" }}>{a.mensagem}</div>
                  <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    {a.email_enviado !== null && a.email_enviado !== undefined && (
                      <span style={{ fontSize: 10.5, color: a.email_enviado ? "#177A50" : "#A32E42" }} title={a.email_erro || ""}>
                        {a.email_enviado ? "✓" : "✕"} E-mail
                      </span>
                    )}
                    {a.teams_enviado !== null && a.teams_enviado !== undefined && (
                      <span style={{ fontSize: 10.5, color: a.teams_enviado ? "#177A50" : "#A32E42" }} title={a.teams_erro || ""}>
                        {a.teams_enviado ? "✓" : "✕"} Teams
                      </span>
                    )}
                  </div>
                  {a.lido && a.lido_em && (
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>
                      ✓ Lido em {formatarDataHora(a.lido_em)} — {VIA_LABEL[a.lido_via] || a.lido_via}
                    </div>
                  )}
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
                  <b style={{ fontSize: 12.5 }}>{TIPO_LABEL[a.tipo] || a.tipo}</b>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatBR(a.data)}</span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 5, whiteSpace: "pre-line" }}>{a.mensagem}</div>
                {!a.lido && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => marcarLido(a.id)}>Marcar como lido</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
