import { useCallback, useEffect, useMemo, useState } from "react";
import { TopBar, Spinner, ErrorBox, Toast } from "../components/UI";
import { useToast } from "../lib/hooks";
import { api } from "../api/client";

const brl = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: d, maximumFractionDigits: d }));
const nint = (v) => Number(v || 0).toLocaleString("pt-BR");
const MASK = "••••••••";

function useDados(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => { api.get(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)); }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload, setData };
}

function Kpi({ label, value, nota, cor }) {
  return (
    <div className="card" style={{ flex: "1 1 220px" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, fontWeight: 600, margin: "6px 0 4px", color: cor }}>{value}</div>
      {nota && <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{nota}</div>}
    </div>
  );
}
const Linha = ({ children }) => <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>{children}</div>;
const Barra = ({ pct, cor = "#E8752E" }) => (
  <div style={{ height: 8, background: "#EEF0F3", borderRadius: 99, minWidth: 80 }}><div style={{ height: 8, borderRadius: 99, background: cor, width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
);

/* ---------------- Visão geral ---------------- */
function Visao() {
  const { data: r, error } = useDados("/custos/resumo");
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Spinner />;
  const c = r.composicao; const totM = r.custo_mensal || 1;
  const comp = [["Salários", c.salario, "#2A2C30"], ["Adicionais", c.adicionais, "#2F6FE8"], ["Benefícios", c.beneficios, "#E8972E"], ["Encargos", c.encargos, "#9AA2B8"], ["Equipamentos (depreciação)", c.equipamentos, "#1F9D6B"]];
  const a = r.ausencias_ano;
  const aus = [["Férias aprovadas", a.ferias], ["Folgas CCT (sindicato)", a.folgas_cct.valor], ["Folgas de plantão", a.folgas_plantao.valor], ["Atestados", a.atestados]];
  const totAus = aus.reduce((s, x) => s + x[1], 0);
  return (
    <>
      {r.pessoas_com_custo < r.pessoas_ativas && <div className="info-box">Só <strong>{r.pessoas_com_custo}</strong> de {r.pessoas_ativas} pessoas ativas têm custo cadastrado — os totais abaixo cobrem apenas elas. Complete em "Cadastro de custos".</div>}
      <Linha>
        <Kpi label="Custo anual (projeção)" value={brl(r.custo_anual)} nota={`${r.pessoas_com_custo} pessoas + equipamentos`} />
        <Kpi label="Custo mensal" value={brl(r.custo_mensal)} nota={`Encargos considerados: ${r.encargos_pct}% sobre salário e adicionais`} />
        <Kpi label="Custo por atendimento" value={r.custo_por_atendimento ? brl(r.custo_por_atendimento.custo_total, 2) : "—"} nota={r.custo_por_atendimento ? `${nint(r.custo_por_atendimento.atendimentos)} atendimentos em ${r.custo_por_atendimento.mes}` : "Informe o volume do mês em Capacidade e volume"} />
        <Kpi label={`Ausências em ${r.ano}`} value={brl(totAus)} nota={`${((totAus / (r.custo_anual || 1)) * 100).toFixed(1).replace(".", ",")}% do custo anual`} />
      </Linha>
      <Linha>
        <div className="card" style={{ flex: "3 1 420px" }}>
          <div className="section-title">Para onde vai o custo mensal</div>
          <div style={{ display: "flex", height: 26, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", margin: "10px 0 14px" }}>
            {comp.map(([n, v, cor]) => <div key={n} title={n} style={{ width: `${(v / totM) * 100}%`, background: cor }} />)}
          </div>
          <table className="tbl"><tbody>{comp.map(([n, v, cor]) => (
            <tr key={n}><td><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: cor, marginRight: 8 }} />{n}</td><td className="mono" style={{ textAlign: "right" }}>{brl(v)}</td><td className="mono" style={{ textAlign: "right", color: "var(--text-muted)" }}>{((v / totM) * 100).toFixed(1).replace(".", ",")}%</td></tr>
          ))}</tbody></table>
        </div>
        <div className="card" style={{ flex: "2 1 320px" }}>
          <div className="section-title">Custo das ausências no ano</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Cada dia ausente vale o custo mensal da pessoa ÷ 30</div>
          {aus.map(([n, v]) => (
            <div key={n} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}><span>{n}</span><span className="mono">{brl(v)}</span></div>
              <Barra pct={totAus ? (v / totAus) * 100 : 0} />
            </div>
          ))}
        </div>
      </Linha>
      <Linha>
        <div className="card" style={{ flex: "1 1 420px" }}>
          <div className="section-title">Custo médio por função</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Grupos com menos de 3 pessoas ficam agrupados para não expor valores individuais.</div>
          <table className="tbl"><thead><tr><th>Função</th><th style={{ textAlign: "right" }}>Pessoas</th><th style={{ textAlign: "right" }}>Média mensal</th></tr></thead>
            <tbody>{r.por_funcao.map((f) => <tr key={f.nome}><td>{f.nome}</td><td className="mono" style={{ textAlign: "right" }}>{f.pessoas}</td><td className="mono" style={{ textAlign: "right" }}>{f.media == null ? MASK : brl(f.media)}</td></tr>)}</tbody></table>
        </div>
        <div className="card" style={{ flex: "1 1 420px" }}>
          <div className="section-title">Custo por setor (mensal)</div>
          <table className="tbl"><thead><tr><th>Setor</th><th style={{ textAlign: "right" }}>Pessoas</th><th style={{ textAlign: "right" }}>Custo no mês</th></tr></thead>
            <tbody>{r.por_setor.map((f) => <tr key={f.nome}><td>{f.nome}</td><td className="mono" style={{ textAlign: "right" }}>{f.pessoas}</td><td className="mono" style={{ textAlign: "right" }}>{brl(f.total_mensal)}</td></tr>)}</tbody></table>
        </div>
      </Linha>
      {r.historico_cpa.length > 0 && (
        <div className="card">
          <div className="section-title">Custo por atendimento por mês</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Calculado com o custo atual da equipe sobre o volume de cada mês.</div>
          <table className="tbl"><thead><tr><th>Mês</th><th style={{ textAlign: "right" }}>Atendimentos</th><th style={{ textAlign: "right" }}>R$ por atendimento</th></tr></thead>
            <tbody>{r.historico_cpa.map((h) => <tr key={h.mes}><td>{h.mes}</td><td className="mono" style={{ textAlign: "right" }}>{nint(h.atendimentos)}</td><td className="mono" style={{ textAlign: "right" }}>{brl(h.valor, 2)}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}

/* ---------------- Cadastro: pessoas + equipamentos ---------------- */
function Pessoas({ showToast }) {
  const { data, error, reload } = useDados("/custos/pessoas");
  const [aberto, setAberto] = useState(null);   // id em edição
  const [form, setForm] = useState({ funcao: "", salario: "", adicionais: "", beneficios: "" });
  const [rev, setRev] = useState({});           // id -> valores revelados (some em 10s)
  const [lote, setLote] = useState({ funcao: "", salario: "", adicionais: "", beneficios: "" });
  const [sel, setSel] = useState({});
  const [busca, setBusca] = useState("");

  const revelar = async (p) => {
    try {
      const v = await api.post(`/custos/pessoas/${p.id}/revelar`);
      setRev((x) => ({ ...x, [p.id]: v }));
      setTimeout(() => setRev((x) => { const n = { ...x }; delete n[p.id]; return n; }), 10000);
    } catch (e) { showToast(e.message); }
  };
  const editar = async (p) => {
    setAberto(p.id);
    if (p.cadastrado) { try { const v = await api.post(`/custos/pessoas/${p.id}/revelar`); setForm({ funcao: v.funcao || "", salario: v.salario, adicionais: v.adicionais, beneficios: v.beneficios }); return; } catch (e) { showToast(e.message); } }
    setForm({ funcao: "", salario: "", adicionais: "", beneficios: "" });
  };
  const salvar = async () => {
    try {
      await api.put(`/custos/pessoas/${aberto}`, { funcao: form.funcao, salario: Number(form.salario) || 0, adicionais: Number(form.adicionais) || 0, beneficios: Number(form.beneficios) || 0 });
      showToast("Custo salvo."); setAberto(null); reload();
    } catch (e) { showToast(e.message); }
  };
  const salvarLote = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length) { showToast("Marque as pessoas que recebem este valor."); return; }
    try {
      const r = await api.post("/custos/pessoas/lote", { colaborador_ids: ids, funcao: lote.funcao, salario: Number(lote.salario) || 0, adicionais: Number(lote.adicionais) || 0, beneficios: Number(lote.beneficios) || 0 });
      showToast(`${r.salvos} pessoa(s) atualizada(s).`); setSel({}); reload();
    } catch (e) { showToast(e.message); }
  };
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const lista = data.filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase()));
  const campo = (f, setF, k, label, tipo = "number") => <div className="field"><label>{label}</label><input type={tipo} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>;
  return (
    <>
      <div className="info-box">Valores ficam ocultos. "Revelar" mostra por 10 segundos e grava no log (quem, quando, de quem). Para preencher várias pessoas iguais de uma vez (ex.: todos os N1), marque-as e use o bloco abaixo.</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Preencher em lote</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          {campo(lote, setLote, "funcao", "Função", "text")}{campo(lote, setLote, "salario", "Salário")}{campo(lote, setLote, "adicionais", "Adicionais")}{campo(lote, setLote, "beneficios", "Benefícios")}
          <button className="btn btn-primary" onClick={salvarLote}>Aplicar às marcadas</button>
        </div>
      </div>
      <div className="card">
        <input type="search" placeholder="Buscar por nome" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ marginBottom: 12, minWidth: 220 }} />
        <table className="tbl">
          <thead><tr><th></th><th>Colaborador</th><th>Setor</th><th>Função</th><th>Salário</th><th>Custo mensal</th><th></th></tr></thead>
          <tbody>{lista.map((p) => {
            const v = rev[p.id];
            return (
              <tr key={p.id}>
                <td><input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel({ ...sel, [p.id]: e.target.checked })} aria-label={`Marcar ${p.nome}`} /></td>
                <td>{p.nome}{!p.cadastrado && <span style={{ marginLeft: 8, fontSize: 11, color: "#B45309" }}>sem custo</span>}</td>
                <td>{p.equipe}</td><td>{p.funcao || "—"}</td>
                <td className="mono">{p.cadastrado ? (v ? brl(v.salario) : MASK) : "—"}</td>
                <td className="mono">{p.cadastrado ? (v ? brl(v.total) : MASK) : "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {p.cadastrado && !v && <button className="btn btn-ghost" onClick={() => revelar(p)}>Revelar</button>}
                  <button className="btn btn-ghost" onClick={() => editar(p)}>{p.cadastrado ? "Editar" : "Cadastrar"}</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {aberto && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,22,28,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
          <div className="card" style={{ maxWidth: 420, width: "100%" }}>
            <div className="section-title">{data.find((p) => p.id === aberto)?.nome}</div>
            {campo(form, setForm, "funcao", "Função", "text")}{campo(form, setForm, "salario", "Salário base (mensal)")}{campo(form, setForm, "adicionais", "Adicionais (função, noturno, DSR)")}{campo(form, setForm, "beneficios", "Benefícios (mensal)")}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setAberto(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Equipamentos({ showToast }) {
  const { data, error, setData } = useDados("/custos/equipamentos");
  const { data: pessoas } = useDados("/custos/pessoas");
  const vazio = { tipo: "Fone", modelo: "", quantidade: 1, valor_unit: "", data_compra: new Date().toISOString().slice(0, 10), setor: "", colaborador_id: "", vida_util_meses: 24, obs: "" };
  const [f, setF] = useState(vazio);
  const setores = useMemo(() => Array.from(new Set((pessoas || []).map((p) => p.equipe))).filter(Boolean), [pessoas]);
  const salvar = async () => {
    try {
      const lista = await api.post("/custos/equipamentos", { ...f, quantidade: Number(f.quantidade), valor_unit: Number(f.valor_unit), vida_util_meses: Number(f.vida_util_meses), setor: f.setor || null, colaborador_id: f.colaborador_id || null, obs: f.obs || null });
      setData(lista); setF(vazio); showToast("Equipamento registrado.");
    } catch (e) { showToast(e.message); }
  };
  const apagar = async (id) => { if (!window.confirm("Apagar este registro de equipamento?")) return; try { setData(await api.delete(`/custos/equipamentos/${id}`)); } catch (e) { showToast(e.message); } };
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const totalInv = data.reduce((s, e) => s + e.total, 0);
  const inp = (k, label, tipo = "text", extra = {}) => <div className="field"><label>{label}</label><input type={tipo} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>;
  return (
    <>
      <div className="info-box">Registre só as compras novas (o que já estava em operação não entra). O custo mensal de cada item é o valor ÷ vida útil, e entra no custo da equipe enquanto estiver dentro da vida útil.</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Novo equipamento</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field"><label>Tipo</label><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{["Fone", "Notebook", "Monitor", "Computador", "Mouse/Teclado", "Celular", "Cadeira", "Outro"].map((t) => <option key={t}>{t}</option>)}</select></div>
          {inp("modelo", "Marca e modelo")}{inp("quantidade", "Qtd.", "number", { min: 1 })}{inp("valor_unit", "Valor unitário (R$)", "number")}{inp("data_compra", "Data da compra", "date")}
          <div className="field"><label>Setor</label><select value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })}><option value="">—</option>{setores.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label>Pessoa (opcional)</label><select value={f.colaborador_id} onChange={(e) => setF({ ...f, colaborador_id: e.target.value })}><option value="">—</option>{(pessoas || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
          {inp("vida_util_meses", "Vida útil (meses)", "number", { min: 1 })}
          <button className="btn btn-primary" onClick={salvar} disabled={!f.valor_unit}>Registrar</button>
        </div>
      </div>
      <div className="card">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>Total investido: <strong>{brl(totalInv)}</strong> · {data.length} registro(s)</div>
        {data.length === 0 ? <div className="empty">Nenhum equipamento registrado.</div> : (
          <table className="tbl"><thead><tr><th>Compra</th><th>Tipo</th><th>Modelo</th><th>Qtd.</th><th>Total</th><th>Custo/mês</th><th>Destino</th><th></th></tr></thead>
            <tbody>{data.map((e) => <tr key={e.id}><td className="mono">{e.data_compra.split("-").reverse().join("/")}</td><td>{e.tipo}</td><td>{e.modelo || "—"}</td><td className="mono">{e.quantidade}</td><td className="mono">{brl(e.total)}</td><td className="mono">{brl(e.custo_mensal)}</td><td>{e.colaborador || e.setor || "—"}</td><td><button className="btn btn-ghost" onClick={() => apagar(e.id)}>Apagar</button></td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}

function Cadastro({ showToast }) {
  const [aba, setAba] = useState("pessoas");
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`btn ${aba === "pessoas" ? "btn-primary" : "btn-ghost"}`} onClick={() => setAba("pessoas")}>Pessoas</button>
        <button className={`btn ${aba === "equip" ? "btn-primary" : "btn-ghost"}`} onClick={() => setAba("equip")}>Equipamentos</button>
      </div>
      {aba === "pessoas" ? <Pessoas showToast={showToast} /> : <Equipamentos showToast={showToast} />}
    </>
  );
}

/* ---------------- Capacidade e volume ---------------- */
function Capacidade({ showToast }) {
  const { data: cap, error, reload } = useDados("/custos/capacidade");
  const { data: vols, setData: setVols } = useDados("/custos/volume");
  const mesAtual = new Date().toISOString().slice(0, 7);
  const [f, setF] = useState({ mes: mesAtual, telefone: "", whatsapp: "", tma_tel: "", tma_wa: "" });
  const [dVol, setDVol] = useState(-10);
  const [dTma, setDTma] = useState(0);
  const [dAbs, setDAbs] = useState(0);
  const salvar = async () => {
    const mmss = (s) => { const [m, x] = String(s).split(":").map(Number); return (m || 0) * 60 + (x || 0); };
    try {
      setVols(await api.put("/custos/volume", { mes: f.mes, telefone: Number(f.telefone) || 0, whatsapp: Number(f.whatsapp) || 0, tma_tel_seg: mmss(f.tma_tel), tma_wa_seg: mmss(f.tma_wa) }));
      reload(); showToast("Volume salvo.");
    } catch (e) { showToast(e.message); }
  };
  if (error) return <ErrorBox error={error} />;
  if (!cap) return <Spinner />;
  const v = cap.volume;
  const calc = (fv, tmaSeg, absPct) => {
    if (!v) return null;
    const horas = (v.telefone * fv * Math.max(0, v.tma_tel_seg + tmaSeg) + v.whatsapp * fv * Math.max(0, v.tma_wa_seg + tmaSeg) / cap.wa_concorrencia) / 3600;
    const prod = cap.horas_mes * (1 - absPct / 100) * (cap.ocupacao_pct / 100);
    const precisa = Math.ceil(horas / prod - 0.05);
    const atend = Math.round((v.telefone + v.whatsapp) * fv);
    return { horas, prod, precisa, atend };
  };
  const base = calc(1, 0, cap.absenteismo_pct);
  const sim = calc(1 + dVol / 100, dTma, cap.absenteismo_pct + dAbs);
  let blocoSim = null;
  if (base && sim) {
    const sobra = cap.pessoas_diretas - sim.precisa;
    const cm = cap.custo_medio_direto || 0;
    const cpaBase = cap.custo_mensal_total / base.atend;
    const cpaIgual = cap.custo_mensal_total / sim.atend;
    const cpaAjust = (cap.custo_mensal_total - Math.max(0, sobra) * cm) / sim.atend;
    blocoSim = (
      <Linha>
        <Kpi label="Pessoas necessárias" value={sim.precisa} nota={`Quadro direto atual: ${cap.pessoas_diretas}`} />
        <Kpi label={sobra >= 0 ? "Sobrando" : "Faltando"} value={Math.abs(sobra)} cor={sobra >= 0 ? "#1F5C3A" : "#A32E42"} nota={`Carga: ${Math.round(sim.horas)} h/mês · cada pessoa rende ${Math.round(sim.prod)} h`} />
        <Kpi label="R$ por atendimento, equipe igual" value={brl(cpaIgual, 2)} nota={`Hoje: ${brl(cpaBase, 2)}`} cor={cpaIgual > cpaBase ? "#A32E42" : undefined} />
        <Kpi label="R$ por atendimento, equipe ajustada" value={brl(cpaAjust, 2)} nota={sobra > 0 && cm ? `Economia de ${brl(sobra * cm)}/mês ao tirar ${sobra}` : "Sem sobra para ajustar"} />
      </Linha>
    );
  }
  const mm = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <>
      <div className="info-box">Quanto o volume pede de gente. Telefone e WhatsApp usam o TMA informado; o WhatsApp divide por {cap.wa_concorrencia} conversas simultâneas. Atendimento direto = {cap.setores_diretos.join(", ")} ({cap.pessoas_diretas} pessoa(s)); ajuste em Parâmetros. O volume é digitado aqui até a integração com o Checkpoint.</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Volume do mês</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field"><label>Mês</label><input type="month" value={f.mes} onChange={(e) => setF({ ...f, mes: e.target.value })} /></div>
          <div className="field"><label>Atend. telefone</label><input type="number" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></div>
          <div className="field"><label>Atend. WhatsApp</label><input type="number" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></div>
          <div className="field"><label>TMA telefone (mm:ss)</label><input value={f.tma_tel} placeholder="06:18" onChange={(e) => setF({ ...f, tma_tel: e.target.value })} /></div>
          <div className="field"><label>TMA WhatsApp (mm:ss)</label><input value={f.tma_wa} placeholder="11:40" onChange={(e) => setF({ ...f, tma_wa: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={salvar}>Salvar volume</button>
        </div>
        {vols && vols.length > 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>Último: {vols[0].mes} · {nint(vols[0].telefone)} tel + {nint(vols[0].whatsapp)} WhatsApp · TMA {mm(vols[0].tma_tel_seg)} / {mm(vols[0].tma_wa_seg)}</div>}
      </div>
      {!v ? <div className="empty">Informe o volume de um mês para simular.</div> : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">E se mudar?</div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {[["Volume", dVol, setDVol, -30, 30, 1, "%"], ["TMA (segundos)", dTma, setDTma, -120, 120, 5, " s"], ["Absenteísmo (pontos)", dAbs, setDAbs, -8, 10, 1, " pp"]].map(([l, val, set, mn, mx, st, u]) => (
                <div key={l} style={{ minWidth: 220 }}>
                  <label style={{ fontSize: 12.5 }}>{l}: <strong>{val > 0 ? "+" : ""}{val}{u}</strong></label>
                  <input type="range" min={mn} max={mx} step={st} value={val} onChange={(e) => set(Number(e.target.value))} style={{ width: "100%" }} />
                </div>
              ))}
            </div>
          </div>
          {blocoSim}
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Menos volume só vira economia se a capacidade que sobra for realocada ou desligada. Monitoramento e ATP (estrutura) não diminuem com o volume.</div>
        </>
      )}
    </>
  );
}

/* ---------------- Desligamento e reposição ---------------- */
function Desligamento({ showToast }) {
  const { data: pessoas } = useDados("/custos/pessoas");
  const [cid, setCid] = useState("");
  const [venc, setVenc] = useState(0);
  const [pct, setPct] = useState(100);
  const [r, setR] = useState(null);
  const simular = async () => {
    try { setR(await api.post("/custos/desligamento", { colaborador_id: cid, ferias_vencidas_dias: Number(venc) || 0, novo_custo_pct: Number(pct) || 100 })); }
    catch (e) { setR(null); showToast(e.message); }
  };
  if (!pessoas) return <Spinner />;
  return (
    <>
      <div className="info-box">Simulação com a regra da CLT (sem justa causa, todas as verbas e encargos pagos) e reposição com contrato de experiência. Usa o custo cadastrado e a data de admissão da pessoa. É uma estimativa: confira com o RH antes de decidir. Nada é salvo.</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field"><label>Pessoa</label><select value={cid} onChange={(e) => setCid(e.target.value)}><option value="">Escolha…</option>{pessoas.filter((p) => p.cadastrado).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
          <div className="field"><label>Férias vencidas (dias)</label><input type="number" min="0" max="60" value={venc} onChange={(e) => setVenc(e.target.value)} /></div>
          <div className="field"><label>Custo do substituto (% do atual)</label><input type="number" min="1" max="300" value={pct} onChange={(e) => setPct(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={!cid} onClick={simular}>Simular</button>
        </div>
      </div>
      {r && (
        <>
          <Linha>
            <Kpi label="Desembolso na rescisão" value={brl(r.rescisao_total)} nota={`${r.anos_casa} ano(s) de casa · aviso de ${r.aviso_dias} dias`} />
            <Kpi label="Custo extra de verdade" value={brl(r.rescisao_extra)} nota="O que não estava provisionado no custo mensal" cor="#A32E42" />
            <Kpi label="Custo de repor" value={brl(r.reposicao_total)} nota="Produtividade parcial na experiência, seleção e cobertura" />
            <Kpi label="Transição completa" value={brl(r.transicao_total)} nota={`≈ ${(r.transicao_total / r.custo_mensal).toFixed(1).replace(".", ",")} meses do custo da pessoa`} cor="#A32E42" />
          </Linha>
          <Linha>
            <div className="card" style={{ flex: "1 1 380px" }}>
              <div className="section-title">Rescisão</div>
              <table className="tbl"><thead><tr><th>Verba</th><th style={{ textAlign: "right" }}>Valor</th><th>Já provisionado</th></tr></thead>
                <tbody>{r.rescisao.map((i) => <tr key={i.nome}><td>{i.nome}</td><td className="mono" style={{ textAlign: "right" }}>{brl(i.valor)}</td><td>{i.provisionado ? "Sim" : "Não"}</td></tr>)}
                  <tr><td><strong>Total</strong></td><td className="mono" style={{ textAlign: "right" }}><strong>{brl(r.rescisao_total)}</strong></td><td /></tr></tbody></table>
            </div>
            <div className="card" style={{ flex: "1 1 380px" }}>
              <div className="section-title">Reposição</div>
              <table className="tbl"><tbody>{r.reposicao.map((i) => <tr key={i.nome}><td>{i.nome}</td><td className="mono" style={{ textAlign: "right" }}>{brl(i.valor)}</td></tr>)}
                <tr><td><strong>Total</strong></td><td className="mono" style={{ textAlign: "right" }}><strong>{brl(r.reposicao_total)}</strong></td></tr></tbody></table>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Encerrar no fim do contrato de experiência não gera aviso nem multa de 40%.</div>
            </div>
          </Linha>
          <div className="card">
            <div className="section-title">O que compensa (12 meses)</div>
            <table className="tbl"><thead><tr><th>Cenário</th><th style={{ textAlign: "right" }}>Custo único</th><th style={{ textAlign: "right" }}>Economia mensal</th><th style={{ textAlign: "right" }}>Se paga em</th><th style={{ textAlign: "right" }}>Resultado em 12 meses</th></tr></thead>
              <tbody>{r.cenarios.map((c) => <tr key={c.nome}><td><strong>{c.nome}</strong><div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.desc}</div></td><td className="mono" style={{ textAlign: "right" }}>{brl(c.custo_unico)}</td><td className="mono" style={{ textAlign: "right" }}>{brl(c.economia_mensal)}</td><td className="mono" style={{ textAlign: "right" }}>{c.payback_meses == null ? "nunca" : `${c.payback_meses.toFixed(1).replace(".", ",")} meses`}</td><td className="mono" style={{ textAlign: "right", color: c.resultado_12m >= 0 ? "#1F5C3A" : "#A32E42", fontWeight: 600 }}>{c.resultado_12m >= 0 ? "+" : "−"} {brl(Math.abs(c.resultado_12m))}</td></tr>)}</tbody></table>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Ausências e folgas CCT ---------------- */
function Ausencias() {
  const { data, error } = useDados("/custos/cct");
  const { data: r } = useDados("/custos/resumo");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const tot = data.linhas.reduce((s, l) => s + l.total, 0), usadas = data.linhas.reduce((s, l) => s + l.usadas, 0);
  const a = r?.ausencias_ano;
  const pill = (l) => {
    const f = l.total - l.usadas;
    const [t, bg, fg] = f === 0 ? ["Concluído", "#E6F4EC", "#1F5C3A"] : l.usadas === 0 ? ["Nenhuma usada", "#FBE7EA", "#A32E42"] : f >= 2 ? ["Atenção", "#FFF3DC", "#7A4A00"] : ["Em dia", "#E8F0FE", "#1D4FB8"];
    return <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: bg, color: fg }}>{t}</span>;
  };
  return (
    <>
      <Linha>
        <Kpi label={`Folgas CCT usadas (ciclo ${data.ciclo})`} value={`${usadas} de ${tot}`} nota={tot ? `${Math.round((usadas / tot) * 100)}% do ciclo` : ""} />
        {a && <Kpi label="Custo das folgas CCT no ano" value={brl(a.folgas_cct.valor)} nota={`${a.folgas_cct.qtd} folga(s) aprovada(s)`} />}
        {a && <Kpi label="Custo de férias aprovadas no ano" value={brl(a.ferias)} />}
        {a && <Kpi label="Custo de atestados no ano" value={brl(a.atestados)} />}
      </Linha>
      <div className="card">
        <div className="section-title">Folgas CCT por colaborador</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Quem usou menos aparece primeiro. Custos de ausência consideram só quem tem custo cadastrado.</div>
        <table className="tbl"><thead><tr><th>Colaborador</th><th>Setor</th><th>Usadas</th><th>Situação</th></tr></thead>
          <tbody>{data.linhas.map((l) => <tr key={l.nome}><td>{l.nome}</td><td>{l.equipe}</td><td className="mono">{l.usadas}/{l.total}</td><td>{pill(l)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}

/* ---------------- Parâmetros e acessos ---------------- */
const ROTULOS = {
  encargos_pct: "Encargos + provisão férias/13º (% sobre salário e adicionais)", horas_mes: "Horas de trabalho por pessoa no mês", absenteismo_pct: "Absenteísmo (%)",
  ocupacao_pct: "Ocupação-alvo (%)", wa_concorrencia: "Conversas simultâneas no WhatsApp", setores_diretos: "Setores de atendimento direto (separados por vírgula, igual ao cadastro)",
  rescisao_encargos_pct: "Encargos patronais sobre verbas da rescisão (%)", recrutamento: "Custo de recrutamento e seleção (R$)", cobertura_vaga: "Cobertura da vaga durante aviso/seleção (R$)",
  exp_etapa1_dias: "Experiência, etapa 1 (dias)", exp_etapa1_prod_pct: "Produtividade na etapa 1 (%)", exp_etapa2_dias: "Experiência, etapa 2 (dias)", exp_etapa2_prod_pct: "Produtividade na etapa 2 (%)",
};
function Config({ showToast }) {
  const { data: p, error } = useDados("/custos/params");
  const { data: acessos, setData: setAcessos } = useDados("/custos/acessos");
  const [vals, setVals] = useState(null);
  const [novo, setNovo] = useState("");
  useEffect(() => { if (p) setVals(p); }, [p]);
  if (error) return <ErrorBox error={error} />;
  if (!vals || !acessos) return <Spinner />;
  const salvar = async () => { try { await api.post("/custos/params", vals); showToast("Parâmetros salvos."); } catch (e) { showToast(e.message); } };
  const liberar = async () => { try { setAcessos(await api.post("/custos/acessos", { email: novo })); setNovo(""); } catch (e) { showToast(e.message); } };
  const remover = async (e) => { if (!window.confirm(`Remover o acesso de ${e}?`)) return; try { setAcessos(await api.delete(`/custos/acessos/${encodeURIComponent(e)}`)); } catch (er) { showToast(er.message); } };
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Quem tem acesso à Gestão de Custos</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Independe do perfil: ser administrador não dá acesso. A pessoa precisa ter o e-mail abaixo no cadastro do Escala.</div>
        {acessos.map((e) => <div key={e} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}><span>{e}</span><button className="btn btn-ghost" onClick={() => remover(e)}>Remover</button></div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}><input type="email" placeholder="e-mail para liberar" value={novo} onChange={(e) => setNovo(e.target.value)} style={{ minWidth: 260 }} /><button className="btn btn-ghost" disabled={!novo} onClick={liberar}>Liberar</button></div>
      </div>
      <div className="card">
        <div className="section-title">Parâmetros dos cálculos</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}>
          {Object.keys(ROTULOS).map((k) => <div className="field" key={k}><label>{ROTULOS[k]}</label><input value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></div>)}
        </div>
        <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={salvar}>Salvar parâmetros</button></div>
      </div>
    </>
  );
}

const TITULOS = {
  "gc-visao": ["Visão geral dos custos", "Equipe de suporte técnico · valores calculados com o cadastro de custos"],
  "gc-cadastro": ["Cadastro de custos", "Pessoas (valores ocultos) e equipamentos comprados"],
  "gc-capacidade": ["Capacidade e volume", "Quantas pessoas o volume pede e o que acontece quando ele muda"],
  "gc-desligamento": ["Desligamento e reposição", "Quanto custa trocar alguém e quando a troca se paga"],
  "gc-ausencias": ["Ausências e folgas CCT", "O que a equipe tirou, o que falta tirar e quanto custa"],
  "gc-config": ["Acessos e parâmetros", "Quem vê esta área e as premissas dos cálculos"],
};

export default function Custos({ tab }) {
  const { toast, showToast } = useToast();
  const [t, sub] = TITULOS[tab] || TITULOS["gc-visao"];
  return (
    <>
      <TopBar title={t} subtitle={sub} />
      <div className="content">
        {tab === "gc-visao" && <Visao />}
        {tab === "gc-cadastro" && <Cadastro showToast={showToast} />}
        {tab === "gc-capacidade" && <Capacidade showToast={showToast} />}
        {tab === "gc-desligamento" && <Desligamento showToast={showToast} />}
        {tab === "gc-ausencias" && <Ausencias />}
        {tab === "gc-config" && <Config showToast={showToast} />}
      </div>
      <Toast toast={toast} />
    </>
  );
}
