import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { ErrorBox, Spinner, Toast, ConfirmModal, TopBar } from "../components/UI";
import { useToast, useConfirm } from "../lib/hooks";
import { linkNvr, useAlturaRestante, vazioParaNull } from "./util";
import CameraFicha from "./CameraFicha";
import CameraForm from "./CameraForm";
import "./ferramentas.css";

const ORIGEM = { life: ["NVR Life", "ft-life"], cliente: ["NVR externo", "ft-cliente"] };
const MARCAS = [["intelbras", "Intelbras / Dahua"], ["hikvision", "Hikvision"], ["outra", "Outra"]];
const marcaTxt = (m) => (MARCAS.find(([v]) => v === m) || [null, m || "—"])[1];

const VAZIO = {
  nome: "", origem: "life", marca: "intelbras", total_canais: "", url_acesso: "", url_https: "", porta_rtsp: "",
  porta_servico: "", dias_gravacao: "", nome_cliente: "", contrato_ixc: "", id_cliente_ixc: "", cidade: "",
  pppoe: "", ip_pppoe: "", observacoes: "",
};

function Campo({ label, children, largo }) {
  return <div className="field" style={largo ? { gridColumn: "1 / -1" } : undefined}><label>{label}</label>{children}</div>;
}

/** Cadastro / edição do gravador (só administradores). */
function GravadorForm({ gravador, onVoltar, showToast }) {
  const editando = !!gravador;
  const [f, setF] = useState(() => (editando
    ? Object.fromEntries(Object.keys(VAZIO).map((k) => [k, gravador[k] === null || gravador[k] === undefined ? "" : String(gravador[k])]))
    : VAZIO));
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const salvar = async () => {
    setErro("");
    if (!f.nome.trim()) { setErro("Dê um nome ao gravador (o mesmo usado na captura das fotos)."); return; }
    const corpo = vazioParaNull({ ...f });
    corpo.total_canais = f.total_canais ? Number(f.total_canais) : null;
    corpo.dias_gravacao = f.dias_gravacao ? Number(f.dias_gravacao) : null;
    setOcupado(true);
    try {
      const r = editando ? await api.patch(`/ferramentas/gravadores/${gravador.id}`, corpo) : await api.post("/ferramentas/gravadores", corpo);
      showToast(editando ? "Gravador atualizado." : "Gravador cadastrado.");
      onVoltar(r.id);
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  };

  return (
    <>
      <TopBar title={editando ? "Editar gravador" : "Novo gravador"} subtitle={editando ? gravador.nome : "NVR Life ou NVR externo"}
        right={<button className="btn btn-ghost" onClick={() => onVoltar(gravador?.id || null)}>← Voltar</button>} />
      <div className="content">
        <ErrorBox error={erro} />
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Gravador</div>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <Campo label="Nome"><input value={f.nome} onChange={set("nome")} placeholder="LIFE - NVR09" /></Campo>
            <Campo label="Onde está instalado">
              <select value={f.origem} onChange={set("origem")}>
                <option value="life">Na Life (NVR Life)</option>
                <option value="cliente">No cliente (NVR externo)</option>
              </select>
            </Campo>
            <Campo label="Marca">
              <select value={f.marca} onChange={set("marca")}>{MARCAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Campo>
            <Campo label="Total de canais"><input type="number" min="1" max="512" value={f.total_canais} onChange={set("total_canais")} className="mono" placeholder="32, 64, 128…" /></Campo>
            <Campo label="Dias de gravação"><input type="number" min="0" value={f.dias_gravacao} onChange={set("dias_gravacao")} /></Campo>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Acesso</div>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <Campo label="Acesso HTTP"><input value={f.url_acesso} onChange={set("url_acesso")} className="mono" placeholder="http://177.105.135.70:4150" /></Campo>
            <Campo label="Acesso HTTPS"><input value={f.url_https} onChange={set("url_https")} className="mono" placeholder="https://177.105.135.70:4151" /></Campo>
            <Campo label="Porta RTSP (pública)"><input value={f.porta_rtsp} onChange={set("porta_rtsp")} className="mono" placeholder="8815" /></Campo>
            <Campo label="Porta de serviço"><input value={f.porta_servico} onChange={set("porta_servico")} className="mono" /></Campo>
          </div>
        </div>
        {f.origem === "cliente" && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">Cliente dono do NVR</div>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <Campo label="Cliente"><input value={f.nome_cliente} onChange={set("nome_cliente")} /></Campo>
              <Campo label="Contrato IXC"><input value={f.contrato_ixc} onChange={set("contrato_ixc")} className="mono" /></Campo>
              <Campo label="ID cliente IXC"><input value={f.id_cliente_ixc} onChange={set("id_cliente_ixc")} className="mono" /></Campo>
              <Campo label="Cidade"><input value={f.cidade} onChange={set("cidade")} /></Campo>
              <Campo label="PPPoE"><input value={f.pppoe} onChange={set("pppoe")} className="mono" /></Campo>
              <Campo label="IP do PPPoE"><input value={f.ip_pppoe} onChange={set("ip_pppoe")} className="mono" /></Campo>
            </div>
          </div>
        )}
        <div className="card">
          <Campo label="Observações" largo><textarea value={f.observacoes} onChange={set("observacoes")} /></Campo>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid #EEF0F3", paddingTop: 14, marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => onVoltar(gravador?.id || null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={ocupado} onClick={salvar}>{ocupado ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar gravador"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Usuários (e senhas cifradas) do NVR. */
function UsuariosNvr({ gravador, onMudou, showToast, confirm }) {
  const [novo, setNovo] = useState({ usuario: "", senha: "", nome_cliente: "" });
  const [aberto, setAberto] = useState(false);
  const adicionar = async () => {
    if (!novo.usuario.trim()) return;
    try {
      await api.post("/ferramentas/credenciais", { gravador_id: gravador.id, usuario: novo.usuario.trim(), senha: novo.senha, nome_cliente: novo.nome_cliente.trim() || null });
      setNovo({ usuario: "", senha: "", nome_cliente: "" });
      showToast("Usuário adicionado.");
      onMudou();
    } catch (e) { showToast(e.message); }
  };
  const remover = async (c) => {
    if (!(await confirm(`O usuário "${c.usuario}" sai da documentação deste gravador.`, { title: "Remover usuário?", confirmLabel: "Remover" }))) return;
    try { await api.delete(`/ferramentas/credenciais/${c.id}`); showToast("Usuário removido."); onMudou(); } catch (e) { showToast(e.message); }
  };
  return (
    <div className="ft-grav-bloco">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2>Usuários do NVR <span className="qtd">{gravador.credenciais.length}</span></h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>{aberto ? "Fechar" : "Ver / adicionar"}</button>
      </div>
      {aberto && (
        <>
          <div className="ft-creds" style={{ marginTop: 8 }}>
            {gravador.credenciais.map((c) => (
              <span key={c.id} className="ft-cred mono">
                {c.usuario}{c.nome_cliente ? <span className="s" style={{ fontFamily: "Inter, sans-serif" }}> · {c.nome_cliente}</span> : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remover(c)} aria-label={`Remover ${c.usuario}`}>✕</button>
              </span>
            ))}
            {!gravador.credenciais.length && <span className="ft-vazio">Nenhum usuário cadastrado.</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <input aria-label="Usuário" placeholder="Usuário" value={novo.usuario} onChange={(e) => setNovo({ ...novo, usuario: e.target.value })} className="ft-input mono" />
            <input aria-label="Senha" placeholder="Senha" type="password" autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} className="ft-input mono" />
            <input aria-label="Cliente (opcional)" placeholder="Cliente deste usuário (opcional)" value={novo.nome_cliente} onChange={(e) => setNovo({ ...novo, nome_cliente: e.target.value })} className="ft-input" style={{ flex: "2 1 200px" }} />
            <button className="btn btn-primary btn-sm" onClick={adicionar} disabled={!novo.usuario.trim()}>Adicionar</button>
          </div>
        </>
      )}
    </div>
  );
}

/** LifeGuard · Gravadores — só administradores (permissão nvr.gerenciar). */
export default function Gravadores({ acesso }) {
  const { toast, showToast } = useToast();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [refTela, altura] = useAlturaRestante();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [q, setQ] = useState("");
  const [verDesativados, setVerDesativados] = useState(false);
  const [selId, setSelId] = useState(null);
  const [det, setDet] = useState(null);
  const [canal, setCanal] = useState(null);
  const [modo, setModo] = useState({ tela: "lista" }); // lista | gravador | camera
  const [ficha, setFicha] = useState(null);

  const carregarLista = useCallback(() => {
    setCarregando(true);
    return api.get("/ferramentas/gravadores?todos=true")
      .then((r) => { setLista(r); setSelId((s) => (r.some((g) => g.id === s) ? s : (r.find((g) => g.ativo) || r[0])?.id ?? null)); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);
  const carregarDet = useCallback(() => {
    if (!selId) { setDet(null); return; }
    api.get(`/ferramentas/gravadores/${selId}`).then(setDet).catch((e) => setErro(e.message));
  }, [selId]);

  useEffect(() => { carregarLista(); }, [carregarLista]);
  useEffect(() => { setDet(null); setCanal(null); carregarDet(); }, [carregarDet]);

  const visiveis = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lista.filter((g) => (verDesativados || g.ativo) && (!t || g.nome.toLowerCase().includes(t)));
  }, [lista, q, verDesativados]);

  const g = lista.find((x) => x.id === selId);
  const porCanal = useMemo(() => Object.fromEntries((det?.canais || []).filter((c) => c.canal).map((c) => [c.canal, c])), [det]);
  const maiorUsado = Math.max(0, ...Object.keys(porCanal).map(Number));
  const total = Math.max(det?.total_canais || 0, maiorUsado);
  const recarregar = () => { carregarLista(); carregarDet(); };

  const voltar = (id) => {
    setModo({ tela: "lista" });
    if (id && modo.tela === "gravador") setSelId(id);
    recarregar();
  };

  if (modo.tela === "gravador") {
    return (<><GravadorForm gravador={modo.gravador} onVoltar={voltar} showToast={showToast} /><Toast toast={toast} /></>);
  }
  if (modo.tela === "camera") {
    return (<><CameraForm cameraId={modo.id} inicial={modo.inicial} substituir={!!modo.substituir} onVoltar={() => voltar(null)} showToast={showToast} confirm={confirm} /><Toast toast={toast} /><ConfirmModal state={confirmState} onResolve={resolveConfirm} /></>);
  }

  const alternarAtivo = async () => {
    const desativar = g.ativo;
    if (desativar && !(await confirm(`"${g.nome}" sai da Documentação, dos filtros e do cadastro de câmeras. As ${g.qtd_cameras} câmeras e as fotos continuam guardadas — é só reativar para voltar.`, { title: "Desativar gravador?", confirmLabel: "Desativar", danger: false }))) return;
    try {
      await api.patch(`/ferramentas/gravadores/${g.id}`, { ativo: !desativar });
      showToast(desativar ? "Gravador desativado." : "Gravador reativado.");
      recarregar();
    } catch (e) { showToast(e.message); }
  };
  const excluir = async () => {
    if (!(await confirm(`"${g.nome}" e os usuários dele serão apagados. Isso não pode ser desfeito.`, { title: "Excluir gravador?", confirmLabel: "Excluir" }))) return;
    try { await api.delete(`/ferramentas/gravadores/${g.id}`); showToast("Gravador excluído."); setSelId(null); carregarLista(); } catch (e) { showToast(e.message); }
  };

  // Linhas prontas para o nvrs.txt do script de captura (sem senhas)
  const linhasCaptura = () => {
    const host = (u) => { try { return new URL(linkNvr(u) || "").hostname; } catch (_) { return ""; } };
    const linhas = ["# Gerado pelo Escala - troque USUARIO e SENHA (Ctrl+H no Bloco de Notas)", ""];
    lista.filter((x) => x.ativo).forEach((x) => {
      const ok = x.porta_rtsp && host(x.url_acesso);
      const canais = `1-${x.total_canais || 32}`;
      const marca = x.marca === "hikvision" ? " ; hikvision" : "";
      linhas.push(`${ok ? "" : "#SEM PORTA RTSP# "}${x.nome} ; ${host(x.url_acesso) || "IP"} ; ${x.porta_rtsp || "PORTA"} ; USUARIO ; SENHA ; ${canais}${marca}`);
    });
    const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "nvrs.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const c = canal ? porCanal[canal] : null;
  const ativos = lista.filter((x) => x.ativo).length;

  return (
    <>
      <div className="ft-doc" ref={refTela} style={altura ? { height: altura } : undefined}>
        <header className="ft-doc-topo">
          <div className="ft-doc-titulo">
            <h1>LifeGuard · Gravadores</h1>
            <span>{ativos} ativos · {lista.length - ativos} desativados</span>
          </div>
          <div className="ft-doc-acoes">
            <button className="btn btn-ghost" onClick={linhasCaptura} title="Arquivo nvrs.txt para o script de captura (sem senhas)">Linhas para captura</button>
            <button className="btn btn-primary" onClick={() => setModo({ tela: "gravador", gravador: null })}>+ Novo gravador</button>
          </div>
        </header>
        {erro && <div style={{ padding: "10px 20px 0" }}><ErrorBox error={erro} /></div>}

        <div className="ft-doc-corpo">
          <section className="ft-grav-lista" aria-label="Gravadores">
            <div className="ft-grav-busca">
              <input type="search" aria-label="Buscar gravador" placeholder="Buscar gravador" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className={`ft-chip ${verDesativados ? "on" : ""}`} aria-pressed={verDesativados} onClick={() => setVerDesativados((v) => !v)}>Mostrar desativados</button>
            </div>
            <div className="ft-rolagem">
              {carregando && !lista.length ? <Spinner /> : visiveis.map((x) => {
                const tot = Math.max(x.total_canais || 0, x.qtd_cameras);
                const pct = tot ? Math.round((x.qtd_cameras / tot) * 100) : 0;
                return (
                  <button key={x.id} type="button" className={`ft-grav-item ${x.id === selId ? "sel" : ""} ${x.ativo ? "" : "off"}`} aria-pressed={x.id === selId} onClick={() => setSelId(x.id)}>
                    <span className="l1"><b>{x.nome}</b><span className={`pill ${ORIGEM[x.origem]?.[1] || "ft-desc"}`}>{ORIGEM[x.origem]?.[0] || x.origem}</span></span>
                    <span className="barra">
                      <span><span style={{ width: x.total_canais ? `${pct}%` : "100%", background: !x.total_canais ? "#D5D9DF" : pct >= 95 ? "#C8432F" : pct >= 80 ? "#E8A33E" : "#3FA06A" }} /></span>
                      <span className="mono">{x.qtd_cameras}/{x.total_canais || "?"}</span>
                    </span>
                    <span className="l2">{x.ativo ? `${x.total_canais ? `${Math.max(0, x.total_canais - x.qtd_cameras)} livres · ` : "total de canais não informado · "}${x.qtd_com_foto} com foto` : "Desativado"}</span>
                  </button>
                );
              })}
              {!carregando && !visiveis.length && <div className="empty">Nenhum gravador.</div>}
            </div>
          </section>

          <section className="ft-grav-det" aria-label="Gravador selecionado">
            {!g || !det ? <Spinner label={g ? "Carregando…" : "Escolha um gravador."} /> : (
              <>
                <div className="ft-grav-topo">
                  <div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span className={`pill ${ORIGEM[g.origem]?.[1]}`}>{ORIGEM[g.origem]?.[0]}</span>
                      <span className={`pill ${g.ativo ? "aprovada" : "ft-desc"}`}>{g.ativo ? "Ativo" : "Desativado"}</span>
                      <span className="ft-origem-txt">{marcaTxt(g.marca)}</span>
                    </div>
                    <div className="display ft-ficha-nome" style={{ fontSize: 19 }}>{g.nome}</div>
                    <div className="ft-ficha-sub">{g.origem === "cliente" ? [g.nome_cliente, g.contrato_ixc && `contrato ${g.contrato_ixc}`].filter(Boolean).join(" · ") || "—" : "Instalado na Life"}</div>
                  </div>
                  <div className="ft-ficha-botoes">
                    {linkNvr(g.url_acesso) && <a className="btn btn-escuro btn-sm" href={linkNvr(g.url_acesso)} target="_blank" rel="noopener noreferrer">↗ Abrir NVR (HTTP)</a>}
                    {linkNvr(g.url_https, "https") && <a className="btn btn-escuro btn-sm" href={linkNvr(g.url_https, "https")} target="_blank" rel="noopener noreferrer">↗ HTTPS</a>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setModo({ tela: "gravador", gravador: { ...g, ...det } })}>Editar gravador</button>
                    <button className="btn btn-sm ft-btn-aviso" onClick={alternarAtivo}>{g.ativo ? "Desativar" : "Reativar"}</button>
                    <button className="btn btn-danger btn-sm" onClick={excluir} disabled={g.qtd_cameras > 0} title={g.qtd_cameras > 0 ? "Só dá para excluir gravador sem câmeras — use Desativar" : "Excluir gravador"}>Excluir</button>
                  </div>
                </div>

                <div className="ft-rolagem" style={{ padding: "0 20px 20px" }}>
                  {!g.ativo && <div className="warn-box" style={{ marginTop: 12 }}>Gravador desativado (retirado de operação). As câmeras e as fotos continuam guardadas, mas não aparecem na Documentação. Reative para voltar a mostrar.</div>}

                  <dl className="ft-dl" style={{ padding: "14px 0", borderBottom: "1px solid #EEF0F3" }}>
                    {[["Acesso HTTP", g.url_acesso, true], ["Acesso HTTPS", g.url_https, true], ["Porta RTSP", g.porta_rtsp, true], ["Total de canais", g.total_canais, true],
                      ["Porta de serviço", g.porta_servico, true], ["Dias de gravação", g.dias_gravacao && `${g.dias_gravacao} dias`], ["Cidade", g.cidade]].map(([k, v, m]) => (
                      <div key={k}><dt>{k}</dt><dd className={m ? "mono" : ""}>{v || "—"}</dd></div>
                    ))}
                  </dl>

                  <div className="ft-grav-bloco">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <h2>Canais <span className="qtd">{det.canais.length} em uso{det.total_canais ? ` · ${Math.max(0, det.total_canais - det.canais.length)} livres · ${det.total_canais} no total` : ""}</span></h2>
                      <span className="ft-legenda-canais">
                        <span><i style={{ background: "#2A2C30" }} /> Em uso com foto</span>
                        <span><i style={{ background: "#DCE8FB" }} /> Em uso sem foto</span>
                        <span><i className="livre" /> Livre</span>
                      </span>
                    </div>
                    {!det.total_canais && <div className="info-box" style={{ marginBottom: 10 }}>Informe o total de canais em "Editar gravador" para ver os canais livres.</div>}
                    <div className="ft-canais">
                      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                        const cam = porCanal[n];
                        return (
                          <button key={n} type="button" className={`ft-canal ${cam ? (cam.tem_foto ? "foto" : "uso") : "livre"} ${canal === n ? "sel" : ""}`}
                            title={cam ? `Canal ${n}: ${cam.nome}` : `Canal ${n} livre`} onClick={() => setCanal(n)}>{String(n).padStart(2, "0")}</button>
                        );
                      })}
                    </div>
                    {canal && (
                      <div className="ft-canal-info">
                        <div style={{ minWidth: 0 }}>
                          <div className="ft-origem-txt" style={{ fontWeight: 600 }}>Canal {String(canal).padStart(2, "0")}</div>
                          <div style={{ fontWeight: 600 }}>{c ? c.nome : "Canal livre"}</div>
                          <div className="ft-ficha-sub">{c ? [c.descricao_local, c.nome_cliente].filter(Boolean).join(" · ") || "—" : "Nenhuma câmera documentada neste canal."}</div>
                        </div>
                        <div className="ft-ficha-botoes">
                          {c ? (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => setFicha(c.id)}>Abrir ficha</button>
                              <button className="btn btn-primary btn-sm" onClick={() => setModo({ tela: "camera", id: c.id, substituir: true })}>Substituir câmera do canal</button>
                            </>
                          ) : g.ativo && (
                            <button className="btn btn-primary btn-sm" onClick={() => setModo({ tela: "camera", inicial: { gravadorId: g.id, canal } })}>+ Cadastrar câmera no canal {canal}</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {acesso.tem("doc.senhas") && <UsuariosNvr gravador={det} onMudou={carregarDet} showToast={showToast} confirm={confirm} />}
                  {g.observacoes && <div className="warn-box" style={{ marginTop: 14, whiteSpace: "pre-line" }}>{g.observacoes}</div>}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {ficha && (
        <div className="ft-gaveta-fundo" onClick={(e) => { if (e.target === e.currentTarget) setFicha(null); }}>
          <aside className="ft-gaveta" aria-label="Ficha da câmera">
            <button className="btn btn-ghost btn-sm ft-gaveta-fechar" onClick={() => setFicha(null)}>✕ Fechar</button>
            <CameraFicha key={ficha} cameraId={ficha}
              onEditar={(id) => { setFicha(null); setModo({ tela: "camera", id }); }}
              onSubstituir={(id) => { setFicha(null); setModo({ tela: "camera", id, substituir: true }); }}
              onMudou={(excluida) => { if (excluida) { setFicha(null); setCanal(null); } recarregar(); }}
              showToast={showToast} confirm={confirm} />
          </aside>
        </div>
      )}
      <Toast toast={toast} />
      <ConfirmModal state={confirmState} onResolve={resolveConfirm} />
    </>
  );
}
