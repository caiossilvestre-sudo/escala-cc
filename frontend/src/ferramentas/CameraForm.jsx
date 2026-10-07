import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { TopBar, ErrorBox } from "../components/UI";
import { lerArquivo, reduzirImagem, vazioParaNull } from "./util";

const CLIENTE_VAZIO = { nome_cliente: "", contrato_ixc: "", id_cliente_ixc: "", cidade: "", pppoe: "", ip_pppoe: "" };
const CAMPOS_LINHA = [
  "nome", "descricao_local", "canal", "numero_cam", "porta_publica", "lg_id", "porta_lifeguard", "porta_monitoramento",
  "link_provisionamento", "ip", "porta", "mac", "modelo", "compressao", "firmware", "dias_gravacao", "status", "observacoes",
];
let _seq = 0;
const novaLinha = (extra = {}) => ({
  key: `l${++_seq}`, ...Object.fromEntries(CAMPOS_LINHA.map((k) => [k, ""])), status: "desconhecido", foto: null, aberta: false, ...extra,
});

function Campo({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

/** Busca de cliente que já existe na documentação (para quem contrata mais câmeras). */
function BuscaCliente({ onEscolher }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState([]);
  const [aberta, setAberta] = useState(false);
  const caixa = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setLista([]); return undefined; }
    const t = setTimeout(() => {
      api.get(`/ferramentas/clientes?q=${encodeURIComponent(q.trim())}`).then((r) => { setLista(r); setAberta(true); }).catch(() => setLista([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberta(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  return (
    <div ref={caixa} style={{ position: "relative", marginBottom: 12 }}>
      <div className="field">
        <label>Cliente que já está na documentação</label>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => lista.length && setAberta(true)}
          placeholder="Buscar por nome, contrato, ID IXC ou PPPoE (deixe vazio se for cliente novo)" />
      </div>
      {aberta && lista.length > 0 && (
        <div role="listbox" style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "100%", marginTop: 4, background: "white", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.12)", maxHeight: 320, overflowY: "auto" }}>
          {lista.map((c, i) => (
            <button key={i} type="button" role="option" aria-selected="false"
              onClick={() => { onEscolher(c); setQ(""); setLista([]); setAberta(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: 0, borderBottom: "1px solid #EEF0F3", background: "white", font: "inherit", cursor: "pointer" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{c.nome_cliente || "(sem nome)"}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                {c.contrato_ixc ? <>Contrato <span className="mono">{c.contrato_ixc}</span> · </> : null}
                {c.cidade ? `${c.cidade} · ` : ""}{c.qtd_cameras} câmera{c.qtd_cameras === 1 ? "" : "s"}
                {c.gravadores?.length ? ` · ${c.gravadores.join(", ")}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
      {aberta && q.trim().length >= 2 && lista.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Nenhum cliente encontrado — preencha abaixo como cliente novo.</div>
      )}
    </div>
  );
}

/** Cadastro de uma ou várias câmeras do mesmo cliente (cameraId vazio) ou
 * edição de uma câmera. Nenhum campo é obrigatório: ao salvar, a tela lista o
 * que está faltando e pergunta se quer salvar mesmo assim. */
export default function CameraForm({ cameraId, onVoltar, showToast, confirm }) {
  const editando = !!cameraId;
  const [cliente, setCliente] = useState(CLIENTE_VAZIO);
  const [clienteExistente, setClienteExistente] = useState(null);
  const [tipo, setTipo] = useState("nvr");
  const [gravadorId, setGravadorId] = useState("");
  const [linhas, setLinhas] = useState(() => [novaLinha()]);
  const [gravadores, setGravadores] = useState([]);
  const [canaisUsados, setCanaisUsados] = useState([]);
  const [canalOriginal, setCanalOriginal] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/ferramentas/gravadores").then(setGravadores).catch((e) => setErro(e.message));
    if (editando) {
      api.get(`/ferramentas/cameras/${cameraId}`).then((c) => {
        const txt = (v) => (v === null || v === undefined ? "" : String(v));
        setCliente(Object.fromEntries(Object.keys(CLIENTE_VAZIO).map((k) => [k, txt(c[k])])));
        setTipo(c.tipo);
        setGravadorId(txt(c.gravador_id));
        setCanalOriginal(c.canal);
        setLinhas([novaLinha({ ...Object.fromEntries(CAMPOS_LINHA.map((k) => [k, txt(c[k])])), status: c.status || "desconhecido", aberta: true })]);
      }).catch((e) => setErro(e.message));
    }
  }, [cameraId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tipo !== "nvr" || !gravadorId) { setCanaisUsados([]); return; }
    api.get(`/ferramentas/gravadores/${gravadorId}`).then((g) => {
      setCanaisUsados(g.canais_usados || []);
      // NVR externo é de um cliente só: se o cliente estiver vazio, já preenche
      if (!editando && g.origem === "cliente") {
        setCliente((c) => (c.nome_cliente || c.contrato_ixc ? c : {
          nome_cliente: g.nome_cliente || "", contrato_ixc: g.contrato_ixc || "", id_cliente_ixc: g.id_cliente_ixc || "",
          cidade: g.cidade || "", pppoe: g.pppoe || "", ip_pppoe: g.ip_pppoe || "",
        }));
      }
    }).catch(() => setCanaisUsados([]));
  }, [gravadorId, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravadorSel = gravadores.find((g) => g.id === gravadorId);
  const usados = useMemo(() => new Set(canaisUsados.filter((c) => !editando || c !== canalOriginal)), [canaisUsados, editando, canalOriginal]);

  const proximoCanal = (lista) => {
    const naTela = new Set(lista.map((l) => Number(l.canal)).filter(Boolean));
    for (let c = 1; c <= 512; c++) if (!usados.has(c) && !naTela.has(c)) return String(c);
    return "";
  };

  const setCli = (k) => (e) => { setCliente((c) => ({ ...c, [k]: e.target.value })); };
  const setLinha = (key, k, v) => setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  const adicionar = (n = 1) => setLinhas((ls) => {
    const novas = [...ls];
    for (let i = 0; i < n; i++) novas.push(novaLinha(tipo === "nvr" && gravadorId ? { canal: proximoCanal(novas) } : {}));
    return novas;
  });
  const remover = (key) => setLinhas((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const escolherCliente = (c) => {
    setCliente({
      nome_cliente: c.nome_cliente || "", contrato_ixc: c.contrato_ixc || "", id_cliente_ixc: c.id_cliente_ixc || "",
      cidade: c.cidade || "", pppoe: c.pppoe || "", ip_pppoe: c.ip_pppoe || "",
    });
    setClienteExistente(c);
  };

  const fotoLinha = async (key, e) => {
    const arq = e.target.files?.[0];
    e.target.value = "";
    if (!arq) return;
    try { setLinha(key, "foto", await reduzirImagem(await lerArquivo(arq))); } catch (err) { showToast(err.message); }
  };

  // O que está faltando — só para avisar; nada impede de salvar
  const faltando = () => {
    const itens = [];
    const cli = [];
    if (!cliente.nome_cliente.trim()) cli.push("nome do cliente");
    if (!cliente.contrato_ixc.trim()) cli.push("contrato IXC");
    if (cli.length) itens.push(`Cliente: ${cli.join(", ")}`);
    if (tipo === "nvr" && !gravadorId) itens.push("Gravador (NVR)");
    linhas.forEach((l, i) => {
      const f = [];
      if (!l.nome.trim()) f.push("nome");
      if (tipo === "nvr" && !String(l.canal).trim()) f.push("canal");
      if (tipo === "lifeguard" && !l.lg_id.trim()) f.push("ID LifeGuard");
      if (!l.ip.trim()) f.push("IP");
      if (!l.mac.trim()) f.push("MAC");
      if (f.length) itens.push(`${linhas.length > 1 ? `Câmera ${i + 1}` : "Câmera"}: ${f.join(", ")}`);
    });
    return itens;
  };

  const corpoDaLinha = (l) => {
    const dados = vazioParaNull({ ...cliente, ...Object.fromEntries(CAMPOS_LINHA.map((k) => [k, l[k]])) });
    dados.tipo = tipo;
    dados.gravador_id = tipo === "nvr" ? (gravadorId || null) : null;
    dados.canal = tipo === "nvr" && l.canal ? Number(l.canal) : null;
    dados.dias_gravacao = l.dias_gravacao ? Number(l.dias_gravacao) : null;
    dados.status = l.status || "desconhecido";
    if (tipo === "nvr") dados.lg_id = null;
    return dados;
  };

  const salvar = async () => {
    setErro("");
    const falta = faltando();
    if (falta.length) {
      const msg = (
        <div>
          <div style={{ marginBottom: 8 }}>Está faltando:</div>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>{falta.map((f) => <li key={f}>{f}</li>)}</ul>
          <div>Deseja salvar mesmo assim?</div>
        </div>
      );
      if (!(await confirm(msg, { title: "Dados incompletos", confirmLabel: "Salvar mesmo assim", cancelLabel: "Voltar e completar", danger: false }))) return;
    }
    setOcupado(true);
    try {
      if (editando) {
        await api.patch(`/ferramentas/cameras/${cameraId}`, corpoDaLinha(linhas[0]));
        showToast("Alterações salvas.");
        onVoltar(cameraId);
        return;
      }
      const { ids } = await api.post("/ferramentas/cameras/lote", { cameras: linhas.map(corpoDaLinha) });
      const comFoto = linhas.map((l, i) => ({ foto: l.foto, id: ids[i], nome: l.nome })).filter((x) => x.foto && x.id);
      let falhasFoto = 0;
      for (let i = 0; i < comFoto.length; i += 5) {
        const bloco = comFoto.slice(i, i + 5);
        try {
          const r = await api.post("/ferramentas/fotos/lote", { substituir: true, itens: bloco.map((x) => ({ camera_id: x.id, imagem_base64: x.foto, arquivo: x.nome || null })) });
          falhasFoto += r.filter((x) => x.status === "erro").length;
        } catch (_) { falhasFoto += bloco.length; }
      }
      const n = ids.length;
      showToast(`${n} câmera${n === 1 ? "" : "s"} cadastrada${n === 1 ? "" : "s"}${falhasFoto ? ` — ${falhasFoto} foto(s) não subiram, importe pela ficha` : ""}.`);
      onVoltar(ids[0]);
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const nvr = tipo === "nvr";
  const nvrLife = nvr && gravadorSel?.origem === "life";

  return (
    <>
      <TopBar
        title={editando ? "Editar câmera" : "Cadastrar câmeras"}
        subtitle={editando ? linhas[0]?.nome : "Uma ou várias câmeras do mesmo cliente"}
        right={<button className="btn btn-ghost" onClick={() => onVoltar(cameraId || null)}>← Voltar</button>}
      />
      <div className="content">
        <ErrorBox error={erro} />

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title"><span className="ft-passo">1</span>Identificar o cliente</div>
          {!editando && <BuscaCliente onEscolher={escolherCliente} />}
          {clienteExistente && (
            <div className="info-box" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span>Cliente já documentado: <b>{clienteExistente.qtd_cameras}</b> câmera{clienteExistente.qtd_cameras === 1 ? "" : "s"}{clienteExistente.gravadores?.length ? ` (${clienteExistente.gravadores.join(", ")})` : ""}. As novas entram junto.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCliente(CLIENTE_VAZIO); setClienteExistente(null); }}>Trocar cliente</button>
            </div>
          )}
          <div className="form-grid" style={{ marginBottom: 0 }}>
            <Campo label="Cliente"><input value={cliente.nome_cliente} onChange={setCli("nome_cliente")} /></Campo>
            <Campo label="Contrato IXC"><input value={cliente.contrato_ixc} onChange={setCli("contrato_ixc")} className="mono" /></Campo>
            <Campo label="ID cliente IXC"><input value={cliente.id_cliente_ixc} onChange={setCli("id_cliente_ixc")} className="mono" /></Campo>
            <Campo label="Cidade"><input value={cliente.cidade} onChange={setCli("cidade")} /></Campo>
            <Campo label="PPPoE"><input value={cliente.pppoe} onChange={setCli("pppoe")} className="mono" /></Campo>
            <Campo label="IP do PPPoE"><input value={cliente.ip_pppoe} onChange={setCli("ip_pppoe")} className="mono" /></Campo>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title"><span className="ft-passo">2</span>Onde as câmeras gravam</div>
          <div className="ft-seg" role="group" aria-label="Tipo" style={{ marginBottom: 12 }}>
            <button type="button" className={nvr ? "on" : ""} onClick={() => setTipo("nvr")}>NVR (canal)</button>
            <button type="button" className={!nvr ? "on" : ""} onClick={() => setTipo("lifeguard")}>LifeGuard (ID)</button>
          </div>
          {nvr && (
            <div className="form-grid" style={{ marginBottom: 0 }}>
              <Campo label="Gravador">
                <select value={gravadorId} onChange={(e) => setGravadorId(e.target.value)}>
                  <option value="">Escolha…</option>
                  <optgroup label="NVR Life (instalado na Life)">
                    {gravadores.filter((g) => g.origem === "life").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </optgroup>
                  <optgroup label="NVR externo (instalado no cliente)">
                    {gravadores.filter((g) => g.origem === "cliente").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </optgroup>
                </select>
              </Campo>
              {gravadorId && <div style={{ alignSelf: "end", fontSize: 12, color: "var(--text-muted)", paddingBottom: 9 }}>{canaisUsados.length} canais já documentados neste gravador</div>}
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="section-title" style={{ margin: 0 }}><span className="ft-passo">3</span>{editando ? "Dados da câmera" : `Dados das câmeras (${linhas.length})`}</div>
            {!editando && (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => adicionar(1)}>+ Adicionar câmera</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => adicionar(4)}>+ 4</button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {linhas.map((l, i) => {
              const canalRepetido = nvr && l.canal && (usados.has(Number(l.canal)) || linhas.some((o) => o.key !== l.key && o.canal && Number(o.canal) === Number(l.canal)));
              return (
                <div key={l.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                    {!editando && <span className="ft-passo" style={{ background: "#EEF0F3", color: "var(--text)", marginTop: 22 }}>{i + 1}</span>}
                    <div className="form-grid" style={{ flex: 1, marginBottom: 0, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
                      <Campo label="Nome"><input value={l.nome} onChange={(e) => setLinha(l.key, "nome", e.target.value)} placeholder={nvr && l.canal ? `CANAL ${l.canal}` : ""} /></Campo>
                      <Campo label="Local"><input value={l.descricao_local} onChange={(e) => setLinha(l.key, "descricao_local", e.target.value)} /></Campo>
                      {nvr ? (
                        <Campo label="Canal"><input type="number" min="1" max="512" value={l.canal} onChange={(e) => setLinha(l.key, "canal", e.target.value)} className="mono" /></Campo>
                      ) : (
                        <>
                          <Campo label="ID LifeGuard"><input value={l.lg_id} onChange={(e) => setLinha(l.key, "lg_id", e.target.value)} className="mono" /></Campo>
                          <Campo label="Porta LifeGuard"><input value={l.porta_lifeguard} onChange={(e) => setLinha(l.key, "porta_lifeguard", e.target.value)} className="mono" /></Campo>
                        </>
                      )}
                      {nvrLife && <Campo label="Porta pública"><input value={l.porta_publica} onChange={(e) => setLinha(l.key, "porta_publica", e.target.value)} className="mono" /></Campo>}
                      <Campo label="IP da câmera"><input value={l.ip} onChange={(e) => setLinha(l.key, "ip", e.target.value)} className="mono" /></Campo>
                      <Campo label="MAC"><input value={l.mac} onChange={(e) => setLinha(l.key, "mac", e.target.value)} className="mono" /></Campo>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 20, flexWrap: "wrap" }}>
                      {!editando && (l.foto ? (
                        <img src={l.foto} alt="" style={{ width: 54, height: 34, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)" }} />
                      ) : null)}
                      {!editando && (
                        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }} title="Foto da documentação (opcional)">
                          {l.foto ? "Trocar foto" : "Foto"}
                          <input type="file" accept="image/*" onChange={(e) => fotoLinha(l.key, e)} style={{ display: "none" }} />
                        </label>
                      )}
                      {!editando && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinha(l.key, "aberta", !l.aberta)} aria-expanded={l.aberta}>
                          {l.aberta ? "Menos" : "Mais dados"}
                        </button>
                      )}
                      {!editando && linhas.length > 1 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => remover(l.key)} aria-label={`Remover câmera ${i + 1}`}>✕</button>
                      )}
                    </div>
                  </div>
                  {canalRepetido && <div className="warn-box" style={{ margin: "10px 0 0" }}>O canal {l.canal} já está documentado neste gravador ou repetido nesta lista.</div>}
                  {l.aberta && (
                    <div className="form-grid" style={{ marginTop: 12, marginBottom: 0, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
                      <Campo label="Porta"><input value={l.porta} onChange={(e) => setLinha(l.key, "porta", e.target.value)} className="mono" /></Campo>
                      <Campo label="Modelo"><input value={l.modelo} onChange={(e) => setLinha(l.key, "modelo", e.target.value)} /></Campo>
                      <Campo label="Firmware"><input value={l.firmware} onChange={(e) => setLinha(l.key, "firmware", e.target.value)} className="mono" /></Campo>
                      <Campo label="Compressão">
                        <select value={l.compressao} onChange={(e) => setLinha(l.key, "compressao", e.target.value)}>
                          <option value="">—</option><option>H.264</option><option>H.265</option><option>MJPEG</option>
                        </select>
                      </Campo>
                      <Campo label="Dias de gravação"><input type="number" min="0" value={l.dias_gravacao} onChange={(e) => setLinha(l.key, "dias_gravacao", e.target.value)} /></Campo>
                      <Campo label="Situação">
                        <select value={l.status} onChange={(e) => setLinha(l.key, "status", e.target.value)}>
                          <option value="desconhecido">Sem informação</option><option value="online">Online</option><option value="offline">Offline</option>
                        </select>
                      </Campo>
                      {nvr ? (
                        <Campo label="Nº da câmera"><input value={l.numero_cam} onChange={(e) => setLinha(l.key, "numero_cam", e.target.value)} className="mono" /></Campo>
                      ) : (
                        <>
                          <Campo label="Porta monitoramento"><input value={l.porta_monitoramento} onChange={(e) => setLinha(l.key, "porta_monitoramento", e.target.value)} className="mono" /></Campo>
                          <Campo label="Link de provisionamento"><input value={l.link_provisionamento} onChange={(e) => setLinha(l.key, "link_provisionamento", e.target.value)} className="mono" /></Campo>
                        </>
                      )}
                      <div className="field" style={{ gridColumn: "1 / -1" }}>
                        <label>Observações</label>
                        <textarea value={l.observacoes} onChange={(e) => setLinha(l.key, "observacoes", e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {editando && <div className="info-box" style={{ marginTop: 12, marginBottom: 0 }}>A foto da documentação é trocada pela ficha da câmera, no botão "Substituir foto".</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", borderTop: "1px solid #EEF0F3", paddingTop: 14, marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => onVoltar(cameraId || null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={ocupado} onClick={salvar}>
              {ocupado ? "Salvando…" : editando ? "Salvar alterações" : `Salvar ${linhas.length} câmera${linhas.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
