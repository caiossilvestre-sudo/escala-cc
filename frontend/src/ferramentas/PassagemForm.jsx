import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { CATEGORIAS, CAT, OBRIGATORIAS, PARA, TURNOS } from "./passagemUtil";
import { AnexosEditor } from "./PassagemAnexos";

const ITEM_VAZIO = { referencia: "", descricao: "", para: "horario_comercial", prioridade: "normal", link: "", anexos: [] };
const novaChave = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Rascunho fica só no navegador de quem está preenchendo (dá para ir anotando
// durante as 12h e enviar no fim). Nunca é obrigatório funcionar.
const chaveRascunho = (userId) => `passagem-rascunho:${userId || "?"}`;
function lerRascunho(userId) {
  try { return JSON.parse(localStorage.getItem(chaveRascunho(userId)) || "null"); } catch { return null; }
}
function gravarRascunho(userId, dados) {
  try { localStorage.setItem(chaveRascunho(userId), JSON.stringify(dados)); } catch { /* sem storage: segue */ }
}
function apagarRascunho(userId) {
  try { localStorage.removeItem(chaveRascunho(userId)); } catch { /* idem */ }
}

function estadoInicial(existente, sugestao) {
  if (existente) {
    return {
      data: existente.data, turno: existente.turno,
      horario_inicio: existente.horario_inicio, horario_fim: existente.horario_fim,
      resumo: existente.resumo || "", recados: existente.recados || "",
      anexos: (existente.anexos || []).map((a) => ({ id: a.id, nome: a.nome })),
      sem_pendencia: existente.sem_pendencia || [],
      // pendência já resolvida não volta para o formulário (fica no histórico)
      itens: (existente.pendencias || []).filter((p) => p.status === "aberta").map((p) => ({
        chave: p.id, id: p.id, categoria: p.categoria, referencia: p.referencia || "", descricao: p.descricao,
        para: p.para, prioridade: p.prioridade, link: p.link || "",
        anexos: (p.anexos || []).filter((a) => a.contexto === "pendencia").map((a) => ({ id: a.id, nome: a.nome })),
      })),
    };
  }
  const s = sugestao || {};
  return {
    data: s.data || new Date().toISOString().slice(0, 10), turno: s.turno || "diurno",
    horario_inicio: s.horario_inicio || "07:00", horario_fim: s.horario_fim || "19:00",
    resumo: "", recados: "", sem_pendencia: [], itens: [], anexos: [],
  };
}

/** Formulário de passagem (nova ou edição). */
export default function PassagemForm({ existente, sugestao, abertasAnteriores = 0, userId, onVoltar, showToast }) {
  const editando = !!existente;
  const rascunho = useRef(editando ? null : lerRascunho(userId));
  const [f, setF] = useState(() => (rascunho.current?.dados ? rascunho.current.dados : estadoInicial(existente, sugestao)));
  const [usouRascunho, setUsouRascunho] = useState(!!rascunho.current?.dados);
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);

  useEffect(() => { if (!editando) gravarRascunho(userId, { dados: f, em: new Date().toISOString() }); }, [f, editando, userId]);

  const campo = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const trocarTurno = (t) => setF((x) => ({ ...x, turno: t, horario_inicio: TURNOS[t].inicio, horario_fim: TURNOS[t].fim }));
  const addItem = (cat) => setF((x) => ({
    ...x, sem_pendencia: x.sem_pendencia.filter((c) => c !== cat),
    itens: [...x.itens, { ...ITEM_VAZIO, chave: novaChave(), categoria: cat }],
  }));
  const mudarItem = (chave, k, v) => setF((x) => ({ ...x, itens: x.itens.map((i) => (i.chave === chave ? { ...i, [k]: v } : i)) }));
  const tirarItem = (chave) => setF((x) => ({ ...x, itens: x.itens.filter((i) => i.chave !== chave) }));
  const marcarNada = (cat, sim) => setF((x) => ({ ...x, sem_pendencia: sim ? [...new Set([...x.sem_pendencia, cat])] : x.sem_pendencia.filter((c) => c !== cat) }));

  const porCat = useMemo(() => Object.fromEntries(CATEGORIAS.map((c) => [c.id, f.itens.filter((i) => i.categoria === c.id)])), [f.itens]);
  const situacao = (cat) => (porCat[cat].length ? "itens" : f.sem_pendencia.includes(cat) ? "nada" : "falta");
  const faltando = OBRIGATORIAS.filter((c) => situacao(c) === "falta");
  const itensIncompletos = f.itens.filter((i) => i.descricao.trim().length < 3);
  const podeEnviar = f.resumo.trim().length >= 3 && !faltando.length && !itensIncompletos.length;

  const descartarRascunho = () => {
    apagarRascunho(userId);
    setF(estadoInicial(null, sugestao));
    setUsouRascunho(false);
  };

  const enviar = async () => {
    setTentou(true);
    if (!podeEnviar) { showToast("Falta preencher algo — veja os avisos em vermelho."); return; }
    setEnviando(true);
    const corpo = {
      data: f.data, turno: f.turno, horario_inicio: f.horario_inicio, horario_fim: f.horario_fim,
      resumo: f.resumo, recados: f.recados || null, sem_pendencia: f.sem_pendencia,
      anexos: (f.anexos || []).map((a) => a.id),
      pendencias: f.itens.map(({ chave, ...i }) => ({ ...i, id: i.id || null, referencia: i.referencia || null, link: i.link || null, anexos: (i.anexos || []).map((a) => a.id) })),
    };
    try {
      if (editando) await api.patch(`/ferramentas/passagem/${existente.id}`, corpo);
      else await api.post("/ferramentas/passagem", corpo);
      if (!editando) apagarRascunho(userId);
      showToast(editando ? "Passagem atualizada." : "Passagem enviada. Bom descanso!");
      onVoltar(true);
    } catch (e) { showToast(e.message); } finally { setEnviando(false); }
  };

  return (
    <div className="pp-form">
      {usouRascunho && (
        <div className="info-box" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span>Continuando o rascunho salvo neste navegador.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={descartarRascunho}>Começar do zero</button>
        </div>
      )}
      {!editando && abertasAnteriores > 0 && (
        <div className="info-box">
          {abertasAnteriores === 1 ? "1 pendência de plantões anteriores continua aberta" : `${abertasAnteriores} pendências de plantões anteriores continuam abertas`} — não precisa repetir aqui. Se mudou algo, comente ou dê baixa nela na aba Pendências.
        </div>
      )}

      <div className="card pp-bloco">
        <div className="pp-bloco-titulo">Plantão</div>
        <div className="form-grid" style={{ marginBottom: 0 }}>
          <div className="field"><label htmlFor="pp-data">Dia em que o plantão começou</label><input id="pp-data" type="date" value={f.data} onChange={(e) => campo("data", e.target.value)} /></div>
          <div className="field"><label>Turno</label>
            <div className="ft-seg" role="group" aria-label="Turno">
              {Object.entries(TURNOS).map(([k, t]) => (
                <button key={k} type="button" className={f.turno === k ? "on" : ""} aria-pressed={f.turno === k} onClick={() => trocarTurno(k)}>{t.label} {t.inicio.slice(0, 2)}–{t.fim.slice(0, 2)}h</button>
              ))}
            </div>
          </div>
          <div className="field"><label htmlFor="pp-ini">Início</label><input id="pp-ini" type="time" value={f.horario_inicio} onChange={(e) => campo("horario_inicio", e.target.value)} /></div>
          <div className="field"><label htmlFor="pp-fim">Fim</label><input id="pp-fim" type="time" value={f.horario_fim} onChange={(e) => campo("horario_fim", e.target.value)} /></div>
        </div>
      </div>

      <div className="card pp-bloco" data-colar>
        <div className="pp-bloco-titulo">O que houve no plantão <span className="obrig">obrigatório</span></div>
        <div className="field">
          <textarea
            rows={5} value={f.resumo} onChange={(e) => campo("resumo", e.target.value)} aria-label="O que houve no plantão"
            placeholder={"Quedas, alarmes, acionamentos, clientes críticos, o que foi resolvido...\nEx.: 02h10 queda do POP Centro (energia), normalizou 02h45. Acionado plantão de campo para cliente X."}
          />
        </div>
        {tentou && f.resumo.trim().length < 3 && <div className="pp-erro">Conte rapidamente como foi o plantão.</div>}
        <AnexosEditor value={f.anexos || []} onChange={(v) => campo("anexos", v)} showToast={showToast} />
      </div>

      <div className="pp-cats">
        {CATEGORIAS.map((c) => {
          const sit = situacao(c.id);
          const obrig = OBRIGATORIAS.includes(c.id);
          return (
            <div key={c.id} className={`card pp-bloco pp-cat ${sit}${tentou && sit === "falta" && obrig ? " erro" : ""}`}>
              <div className="pp-cat-topo">
                <div>
                  <div className="pp-bloco-titulo"><span className={`pill pp-${c.id}`}>{c.nome}</span>
                    {sit === "itens" && <span className="pp-ok">{porCat[c.id].length} {porCat[c.id].length === 1 ? "pendência" : "pendências"}</span>}
                    {sit === "nada" && <span className="pp-ok">✓ nada pendente</span>}
                    {sit === "falta" && obrig && <span className="pp-falta">responder</span>}
                  </div>
                  <div className="pp-dica">{c.dica}</div>
                </div>
                <div className="pp-cat-acoes">
                  {obrig && !porCat[c.id].length && (
                    <label className="pp-nada">
                      <input type="checkbox" checked={f.sem_pendencia.includes(c.id)} onChange={(e) => marcarNada(c.id, e.target.checked)} />
                      Nada pendente
                    </label>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => addItem(c.id)}>+ Pendência</button>
                </div>
              </div>

              {porCat[c.id].map((i) => (
                <div key={i.chave} className="pp-item" data-colar>
                  <div className="pp-item-grade">
                    <div className="field"><label>{CAT[c.id].ref}</label><input value={i.referencia} maxLength={200} onChange={(e) => mudarItem(i.chave, "referencia", e.target.value)} /></div>
                    <div className="field"><label>Ver em</label>
                      <select value={i.para} onChange={(e) => mudarItem(i.chave, "para", e.target.value)}>
                        {Object.entries(PARA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div className="field pp-item-desc"><label>O que precisa ser feito</label>
                      <textarea rows={2} value={i.descricao} maxLength={4000} onChange={(e) => mudarItem(i.chave, "descricao", e.target.value)} placeholder="Situação atual e o que o próximo turno / o horário comercial deve fazer" />
                    </div>
                    <div className="field"><label>Link (opcional)</label><input value={i.link} maxLength={500} placeholder="https://..." onChange={(e) => mudarItem(i.chave, "link", e.target.value)} /></div>
                  </div>
                  <AnexosEditor value={i.anexos || []} onChange={(v) => mudarItem(i.chave, "anexos", v)} showToast={showToast} />
                  <div className="pp-item-rodape">
                    <label className="pp-nada"><input type="checkbox" checked={i.prioridade === "alta"} onChange={(e) => mudarItem(i.chave, "prioridade", e.target.checked ? "alta" : "normal")} /> Prioridade alta</label>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => tirarItem(i.chave)}>Remover</button>
                  </div>
                  {tentou && i.descricao.trim().length < 3 && <div className="pp-erro">Descreva o que precisa ser feito.</div>}
                </div>
              ))}
              {tentou && sit === "falta" && obrig && <div className="pp-erro">Lance a pendência ou marque “Nada pendente”.</div>}
            </div>
          );
        })}
      </div>

      <div className="card pp-bloco">
        <div className="pp-bloco-titulo">Recado para o próximo plantão <span className="opc">opcional</span></div>
        <div className="field"><textarea rows={3} value={f.recados} onChange={(e) => campo("recados", e.target.value)} aria-label="Recado para o próximo plantão" placeholder="Algo que quem entra precisa saber logo de cara" /></div>
      </div>

      <div className="pp-rodape">
        <span className="pp-rodape-info">
          {faltando.length ? `Falta responder: ${faltando.map((c) => CAT[c].nome).join(", ")}` : `${f.itens.length} ${f.itens.length === 1 ? "pendência" : "pendências"} nesta passagem`}
          {!editando && " · rascunho salvo automaticamente"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onVoltar(false)}>{editando ? "Cancelar" : "Voltar"}</button>
          <button type="button" className="btn btn-primary" disabled={enviando} onClick={enviar}>{editando ? "Salvar alterações" : "Enviar passagem"}</button>
        </div>
      </div>
    </div>
  );
}
