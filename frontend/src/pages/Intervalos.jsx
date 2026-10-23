import { useMemo, useState } from "react";
import { TopBar, Spinner, ErrorBox, Toast } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";

const mais1h = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(Math.floor(((h * 60 + m + 60) % 1440) / 60)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Cadastro em lote do intervalo de cada colaborador. Quem tem intervalo
 * recebe um lembrete no Teams 15 min antes e o horário aparece no Dashboard. */
export default function Intervalos({ user }) {
  const { data, loading, error, reload } = useApiList("/colaboradores");
  const { toast, showToast } = useToast();
  const [edicoes, setEdicoes] = useState({}); // id -> { ini, fim } (só o que foi mexido)
  const [filtroSetor, setFiltroSetor] = useState("Todos");
  const [busca, setBusca] = useState("");
  const [somenteSem, setSomenteSem] = useState(false);
  const [lote, setLote] = useState({ setor: "Todos", ini: "12:00", fim: "13:00" });
  const [salvando, setSalvando] = useState(false);

  const pessoas = useMemo(
    () => data.filter((c) => c.role === "colaborador" || c.role === "supervisor").slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })),
    [data],
  );
  const setores = Array.from(new Set(pessoas.map((c) => c.equipe))).filter(Boolean);
  const valor = (c) => edicoes[c.id] || { ini: c.intervalo_inicio || "", fim: c.intervalo_fim || "" };
  const semIntervalo = (c) => { const v = valor(c); return !v.ini && !v.fim; };
  const alterados = pessoas.filter((c) => {
    const e = edicoes[c.id];
    return e && (e.ini !== (c.intervalo_inicio || "") || e.fim !== (c.intervalo_fim || ""));
  });
  const totalSem = pessoas.filter(semIntervalo).length;

  const lista = pessoas.filter((c) =>
    (filtroSetor === "Todos" || c.equipe === filtroSetor) &&
    (!busca || c.nome.toLowerCase().includes(busca.toLowerCase())) &&
    (!somenteSem || semIntervalo(c)));

  const mudar = (c, campo, v) => {
    const atual = valor(c);
    const novo = { ...atual, [campo]: v };
    if (campo === "ini" && v && !atual.fim) novo.fim = mais1h(v); // sugere 1h de intervalo
    setEdicoes({ ...edicoes, [c.id]: novo });
  };

  const preencherVazios = () => {
    if (!lote.ini || !lote.fim) { showToast("Informe o início e o fim do intervalo."); return; }
    const novo = { ...edicoes };
    let n = 0;
    pessoas.filter((c) => (lote.setor === "Todos" || c.equipe === lote.setor) && semIntervalo(c)).forEach((c) => { novo[c.id] = { ini: lote.ini, fim: lote.fim }; n++; });
    setEdicoes(novo);
    showToast(n ? `${n} pessoa(s) preenchida(s) — confira e clique em Salvar.` : "Ninguém sem intervalo nesse setor.");
  };

  const salvar = async () => {
    const itens = alterados.map((c) => ({ colaborador_id: c.id, intervalo_inicio: edicoes[c.id].ini || null, intervalo_fim: edicoes[c.id].fim || null }));
    const incompleto = alterados.find((c) => !!edicoes[c.id].ini !== !!edicoes[c.id].fim);
    if (incompleto) { showToast(`${incompleto.nome}: preencha o início e o fim (ou limpe os dois).`); return; }
    setSalvando(true);
    try {
      await api.post("/colaboradores/intervalos", { itens });
      showToast(`${itens.length} intervalo(s) salvo(s).`);
      setEdicoes({});
      reload();
    } catch (e) { showToast(e.message || "Erro ao salvar."); } finally { setSalvando(false); }
  };

  return (
    <>
      <TopBar title="Intervalos" subtitle="Horário de intervalo de cada colaborador — lembrete no Teams 15 min antes" />
      <div className="content">
        <ErrorBox error={error} />
        <div className="info-box">
          O lembrete só é enviado para quem está de serviço naquele dia (sem folga, férias ou atestado; em domingo/feriado, só com plantão). Quem está sem intervalo cadastrado não recebe nada.
          {!loading && <> <strong>{totalSem}</strong> de {pessoas.length} ainda sem intervalo.</>}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Preencher em lote</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Aplica o mesmo horário a quem ainda não tem intervalo no setor escolhido. Nada é salvo até clicar em "Salvar alterações".</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field"><label>Setor</label>
              <select value={lote.setor} onChange={(e) => setLote({ ...lote, setor: e.target.value })}><option>Todos</option>{setores.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div className="field"><label>Início</label><input type="time" value={lote.ini} onChange={(e) => setLote({ ...lote, ini: e.target.value, fim: e.target.value ? mais1h(e.target.value) : lote.fim })} /></div>
            <div className="field"><label>Fim</label><input type="time" value={lote.fim} onChange={(e) => setLote({ ...lote, fim: e.target.value })} /></div>
            <button className="btn btn-ghost" onClick={preencherVazios}>Preencher quem está sem intervalo</button>
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input type="search" placeholder="Buscar por nome" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 200 }} />
            <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)}><option>Todos</option>{setores.map((s) => <option key={s}>{s}</option>)}</select>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}><input type="checkbox" checked={somenteSem} onChange={(e) => setSomenteSem(e.target.checked)} /> Só quem está sem intervalo</label>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {alterados.length > 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{alterados.length} alteração(ões) não salva(s)</span>}
              {alterados.length > 0 && <button className="btn btn-ghost" onClick={() => setEdicoes({})}>Descartar</button>}
              <button className="btn btn-primary" disabled={salvando || alterados.length === 0} onClick={salvar}>Salvar alterações</button>
            </div>
          </div>
          {loading ? <Spinner /> : lista.length === 0 ? <div className="empty">Ninguém encontrado.</div> : (
            <table className="tbl">
              <thead><tr><th>Colaborador</th><th>Setor</th><th>Expediente</th><th>Início do intervalo</th><th>Fim do intervalo</th></tr></thead>
              <tbody>{lista.map((c) => {
                const v = valor(c);
                const mexeu = alterados.some((a) => a.id === c.id);
                return (
                  <tr key={c.id} style={mexeu ? { background: "#FFF9F2" } : undefined}>
                    <td>{c.nome}{semIntervalo(c) && <span style={{ marginLeft: 8, fontSize: 11, color: "#B45309" }}>sem intervalo</span>}</td>
                    <td>{c.equipe}</td>
                    <td className="mono">{c.horario_inicio}–{c.horario_fim}</td>
                    <td><input type="time" value={v.ini} aria-label={`Início do intervalo — ${c.nome}`} onChange={(e) => mudar(c, "ini", e.target.value)} /></td>
                    <td><input type="time" value={v.fim} aria-label={`Fim do intervalo — ${c.nome}`} onChange={(e) => mudar(c, "fim", e.target.value)} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
