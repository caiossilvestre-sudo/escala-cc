import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { ErrorBox, Spinner, Toast, ConfirmModal, TopBar } from "../components/UI";
import { useToast, useConfirm } from "../lib/hooks";
import { dataHora } from "./util";
import CameraFicha from "./CameraFicha";
import CameraForm from "./CameraForm";
import "./ferramentas.css";

const ABAS = [["aberta", "Abertas"], ["resolvida", "Resolvidas"], ["recusada", "Recusadas"]];
const COR_TIPO = { foto: "aprovada", trocada: "ft-lg", dados: "ft-life", removida: "rejeitada", outro: "ft-desc" };

function FotoPedido({ id }) {
  const [src, setSrc] = useState(null);
  const [grande, setGrande] = useState(false);
  useEffect(() => {
    api.get(`/ferramentas/solicitacoes/${id}/foto`).then((f) => setSrc(`data:${f.mime};base64,${f.imagem_base64}`)).catch(() => setSrc(null));
  }, [id]);
  if (!src) return <div className="ft-ped-foto vazia" />;
  return (
    <>
      <button type="button" className="ft-ped-foto" onClick={() => setGrande(true)} aria-label="Ver foto grande"><img src={src} alt="Foto enviada pelo técnico" /></button>
      {grande && (
        <div className="ft-gaveta-fundo" style={{ justifyContent: "center", alignItems: "center" }} onClick={() => setGrande(false)}>
          <img src={src} alt="Foto enviada pelo técnico" style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 10 }} />
        </div>
      )}
    </>
  );
}

/** Solicitações dos técnicos. Quem trata (N2) vê todas e resolve/recusa;
 *  os demais veem só os próprios pedidos ("Meus pedidos"). */
export default function Solicitacoes({ acesso }) {
  const trata = acesso.tem("doc.tratar");
  const { toast, showToast } = useToast();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [aba, setAba] = useState("aberta");
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [recusando, setRecusando] = useState(null); // id + texto
  const [motivo, setMotivo] = useState("");
  const [ficha, setFicha] = useState(null);
  const [modo, setModo] = useState(null); // { id, substituir }
  const [ocupado, setOcupado] = useState(null);

  const carregar = useCallback(() => {
    setErro("");
    api.get(`/ferramentas/solicitacoes?status=${aba}`).then(setLista).catch((e) => setErro(e.message));
    window.dispatchEvent(new Event("ft-solicitacoes-mudou")); // atualiza o contador do menu
  }, [aba]);
  useEffect(() => { setLista(null); carregar(); }, [carregar]);

  if (modo) {
    return (<><CameraForm cameraId={modo.id} substituir={!!modo.substituir} onVoltar={() => { setModo(null); carregar(); }} showToast={showToast} confirm={confirm} /><Toast toast={toast} /><ConfirmModal state={confirmState} onResolve={resolveConfirm} /></>);
  }

  const resolver = async (s, usarFoto) => {
    if (!usarFoto && !(await confirm("Use quando a documentação já foi ajustada (ou não precisava). O técnico vê que foi resolvido.", { title: "Marcar como resolvida?", confirmLabel: "Resolvida", danger: false }))) return;
    setOcupado(s.id);
    try {
      await api.post(`/ferramentas/solicitacoes/${s.id}/resolver`, { usar_foto: usarFoto, resposta: usarFoto ? "Foto aplicada na documentação." : null });
      showToast(usarFoto ? "Foto aplicada na documentação." : "Solicitação resolvida.");
      carregar();
    } catch (e) { showToast(e.message); } finally { setOcupado(null); }
  };
  const recusar = async (s) => {
    if (!motivo.trim()) { showToast("Escreva o motivo — o técnico vai ver."); return; }
    setOcupado(s.id);
    try {
      await api.post(`/ferramentas/solicitacoes/${s.id}/recusar`, { resposta: motivo.trim() });
      showToast("Solicitação recusada.");
      setRecusando(null); setMotivo("");
      carregar();
    } catch (e) { showToast(e.message); } finally { setOcupado(null); }
  };

  return (
    <>
      <TopBar
        title={trata ? "LifeGuard · Solicitações" : "LifeGuard · Meus pedidos"}
        subtitle={trata ? "Pedidos dos técnicos — nada muda na documentação até alguém tratar" : "O que você pediu ao N2 e o retorno de cada pedido"}
        right={<div className="ft-seg" role="group" aria-label="Situação">{ABAS.map(([v, l]) => <button key={v} type="button" className={aba === v ? "on" : ""} onClick={() => setAba(v)}>{l}</button>)}</div>}
      />
      <div className="content">
        <ErrorBox error={erro} />
        {!lista ? <Spinner /> : !lista.length ? (
          <div className="card empty">{aba === "aberta" ? "Nenhuma solicitação aberta. 🎉" : "Nada por aqui."}</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {lista.map((s) => (
              <div key={s.id} className="ft-ped">
                {s.tem_foto ? <FotoPedido id={s.id} /> : <div className="ft-ped-foto vazia" />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`pill ${COR_TIPO[s.tipo] || "ft-desc"}`}>{s.tipo_label}</span>
                    <b>{s.camera_nome || "Câmera excluída"}</b>
                    <span className="ft-origem-txt">{[s.camera_local, s.cliente].filter(Boolean).join(" · ")}</span>
                  </div>
                  {s.texto && <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-line" }}>{s.texto}</div>}
                  <div className="ft-origem-txt" style={{ marginTop: 4 }}>
                    {trata ? `Enviado por ${s.criado_por_nome || "—"} · ` : ""}{dataHora(s.criado_em)}
                    {s.status !== "aberta" && ` · ${s.status === "resolvida" ? "Resolvida" : "Recusada"} por ${s.tratado_por_nome || "—"} em ${dataHora(s.tratado_em)}`}
                  </div>
                  {s.resposta && <div className={s.status === "recusada" ? "warn-box" : "info-box"} style={{ margin: "8px 0 0" }}>{s.resposta}</div>}
                  {recusando === s.id && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <input className="ft-input" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da recusa (o técnico vai ver)" style={{ flex: "1 1 260px" }} />
                      <button className="btn btn-danger btn-sm" disabled={ocupado === s.id} onClick={() => recusar(s)}>Confirmar recusa</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setRecusando(null); setMotivo(""); }}>Cancelar</button>
                    </div>
                  )}
                </div>
                {trata && s.status === "aberta" && (
                  <div className="ft-ped-acoes">
                    {s.tem_foto && s.camera_id && <button className="btn btn-primary btn-sm" disabled={ocupado === s.id} onClick={() => resolver(s, true)}>Usar esta foto</button>}
                    {s.camera_id && <button className="btn btn-ghost btn-sm" onClick={() => setFicha(s.camera_id)}>Abrir ficha</button>}
                    <button className="btn btn-ghost btn-sm" disabled={ocupado === s.id} onClick={() => resolver(s, false)}>Marcar resolvida</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { setRecusando(s.id); setMotivo(""); }}>Recusar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {ficha && (
        <div className="ft-gaveta-fundo" onClick={(e) => { if (e.target === e.currentTarget) setFicha(null); }}>
          <aside className="ft-gaveta" aria-label="Ficha da câmera">
            <button className="btn btn-ghost btn-sm ft-gaveta-fechar" onClick={() => setFicha(null)}>✕ Fechar</button>
            <CameraFicha key={ficha} cameraId={ficha}
              onEditar={(id) => { setFicha(null); setModo({ id }); }}
              onSubstituir={(id) => { setFicha(null); setModo({ id, substituir: true }); }}
              onMudou={(excluida) => { if (excluida) setFicha(null); carregar(); }}
              showToast={showToast} confirm={confirm} />
          </aside>
        </div>
      )}
      <Toast toast={toast} />
      <ConfirmModal state={confirmState} onResolve={resolveConfirm} />
    </>
  );
}
