// Passagem de plantão — constantes e o cartão de pendência usado em várias telas.
import { createContext, useContext, useState } from "react";
import { api } from "../api/client";
import { dataHora } from "./util";
import { AnexosEditor, AnexosVer } from "./PassagemAnexos";

export const CATEGORIAS = [
  { id: "prtg", nome: "PRTG", dica: "Sensor que precisa ser visto em horário comercial", ref: "Sensor / device (ex.: OLT-Centro · Ping)" },
  { id: "ixc", nome: "IXC", dica: "Tratativa ou atendimento que ficou em aberto", ref: "Nº do atendimento / cliente" },
  { id: "zammad", nome: "Zammad", dica: "Ticket que precisa de continuidade", ref: "Nº do ticket" },
  { id: "projeto", nome: "Projetos", dica: "Projeto, ativação ou mudança que ficou para depois", ref: "Nome do projeto" },
  { id: "outro", nome: "Outros", dica: "Qualquer outro assunto (opcional)", ref: "Assunto" },
];
export const CAT = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));
export const OBRIGATORIAS = ["prtg", "ixc", "zammad", "projeto"];
export const PARA = { horario_comercial: "Horário comercial", proximo_plantao: "Próximo plantão" };
export const TURNOS = {
  diurno: { label: "Diurno", inicio: "07:00", fim: "19:00" },
  noturno: { label: "Noturno", inicio: "19:00", fim: "07:00" },
};

/** "2026-10-25" -> "25/10" (ou "25/10/2026" com ano). */
export function diaMes(iso, ano = false) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return ano ? `${d}/${m}/${a}` : `${d}/${m}`;
}

export function rotuloPlantao(p) {
  if (!p) return "";
  return `${TURNOS[p.turno]?.label || p.turno} · ${diaMes(p.data)} (${p.horario_inicio}–${p.horario_fim})`;
}

/** Tempo desde um instante em UTC, curto: "agora", "35 min", "5 h", "3 dias". */
export function haQuanto(iso) {
  if (!iso) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 2) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

export function linkSeguro(url) {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Quem está usando a tela: { eu: id do colaborador, gerencia: bool } — decide o botão Excluir. */
export const PassagemUsuario = createContext({ eu: null, gerencia: false });

/** Uma pendência, com comentar / resolver / reabrir / excluir. onMudou(pendenciaAtualizada);
 * excluída chega como { ...p, status: "excluida" }. */
export function PendenciaCard({ p, onMudou, showToast, mostrarOrigem = true }) {
  const [acao, setAcao] = useState(null); // null | "resolver" | "comentar"
  const [texto, setTexto] = useState("");
  const [prints, setPrints] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [verTudo, setVerTudo] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const { eu, gerencia } = useContext(PassagemUsuario);
  const podeExcluir = gerencia || (p.criada_por_id && p.criada_por_id === eu && p.status === "aberta");
  const excluir = async () => {
    setEnviando(true);
    try {
      await api.delete(`/ferramentas/passagem/pendencias/${p.id}`);
      showToast?.("Pendência excluída.");
      onMudou?.({ ...p, status: "excluida" });
    } catch (e) { showToast?.(e.message); setEnviando(false); }
  };
  const cat = CAT[p.categoria] || { nome: p.categoria };
  const hist = p.historico || [];
  const histVisivel = verTudo ? hist : hist.slice(-1);
  const link = linkSeguro(p.link);
  const anexos = p.anexos || [];
  const doContexto = (ctx) => anexos.filter((a) => a.contexto === ctx);
  const porId = Object.fromEntries(anexos.map((a) => [a.id, a]));

  const enviar = async (tipo) => {
    setEnviando(true);
    try {
      const r = await api.post(`/ferramentas/passagem/pendencias/${p.id}/${tipo}`, { texto, anexos: prints.map((a) => a.id) });
      setAcao(null); setTexto(""); setPrints([]);
      showToast?.(tipo === "resolver" ? "Pendência baixada." : tipo === "reabrir" ? "Pendência reaberta." : "Comentário registrado.");
      onMudou?.(r);
    } catch (e) { showToast?.(e.message); } finally { setEnviando(false); }
  };

  return (
    <div className={`pp-card${p.prioridade === "alta" && p.status === "aberta" ? " alta" : ""}${p.status === "resolvida" ? " feita" : ""}`}>
      <div className="pp-card-topo">
        <span className={`pill pp-${p.categoria}`}>{cat.nome}</span>
        {p.prioridade === "alta" && p.status === "aberta" && <span className="pill rejeitada">Prioridade alta</span>}
        <span className={`pill ${p.para === "proximo_plantao" ? "plantao" : "pendente"}`}>{PARA[p.para] || p.para}</span>
        {p.status === "resolvida" && <span className="pill aprovada">Resolvida</span>}
        <span className="pp-quando" title={dataHora(p.criada_em)}>aberta há {haQuanto(p.criada_em)}</span>
      </div>
      {p.referencia && <div className="pp-ref">{p.referencia}</div>}
      <div className="pp-desc">{p.descricao}</div>
      <AnexosVer anexos={doContexto("pendencia")} />
      <div className="pp-meta">
        {mostrarOrigem && p.origem && <span>Registrada por {p.origem.autor} · plantão {(TURNOS[p.origem.turno]?.label || "").toLowerCase()} {diaMes(p.origem.data)}</span>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer">Abrir link ↗</a>}
      </div>

      {hist.length > 0 && (
        <div className="pp-hist">
          {hist.length > 1 && !verTudo && <button type="button" className="ft-link" onClick={() => setVerTudo(true)}>Ver os {hist.length} comentários</button>}
          {histVisivel.map((h, i) => (
            <div key={i} className="pp-hist-item"><b>{h.por || "—"}</b> · {dataHora(h.em)}{h.texto && <div>{h.texto}</div>}
              <AnexosVer anexos={(h.anexos || []).map((id) => porId[id]).filter(Boolean)} /></div>
          ))}
        </div>
      )}

      {p.status === "resolvida" && (
        <div className="pp-solucao"><b>Solução</b> — {p.resolucao}<AnexosVer anexos={doContexto("resolucao")} /><div className="pp-meta">{p.resolvida_por} · {dataHora(p.resolvida_em)}</div></div>
      )}

      {acao ? (
        <div className="pp-acao" data-colar>
          <textarea
            autoFocus rows={2} value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={acao === "resolver" ? "Como foi resolvido? (ex.: sensor normalizado após troca do SFP)" : "Andamento (ex.: N2 acionado, aguardando retorno do cliente)"}
          />
          <AnexosEditor value={prints} onChange={setPrints} showToast={showToast} rotulo="Anexar print (comprovação)" />
          <div className="pp-acao-botoes">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAcao(null); setTexto(""); setPrints([]); }}>Cancelar</button>
            <button type="button" className={`btn btn-sm ${acao === "resolver" ? "btn-success" : "btn-primary"}`} disabled={enviando || (acao === "resolver" ? texto.trim().length < 3 : !texto.trim() && !prints.length)} onClick={() => enviar(acao)}>
              {acao === "resolver" ? "Confirmar baixa" : "Comentar"}
            </button>
          </div>
        </div>
      ) : confirmarExclusao ? (
        <div className="pp-acao-botoes pp-confirma">
          <span>Excluir esta pendência{(p.anexos || []).length ? " e os prints dela" : ""}? Não dá para desfazer.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmarExclusao(false)}>Não</button>
          <button type="button" className="btn btn-danger btn-sm" disabled={enviando} onClick={excluir}>Sim, excluir</button>
        </div>
      ) : (
        <div className="pp-acao-botoes">
          {podeExcluir && <button type="button" className="btn btn-ghost btn-sm pp-excluir" onClick={() => setConfirmarExclusao(true)}>Excluir</button>}
          {p.status === "aberta" ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcao("comentar")}>Comentar</button>
              <button type="button" className="btn btn-success btn-sm" onClick={() => setAcao("resolver")}>Dar baixa</button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" disabled={enviando} onClick={() => enviar("reabrir")}>Reabrir</button>
          )}
        </div>
      )}
    </div>
  );
}
