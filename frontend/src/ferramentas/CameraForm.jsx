import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { TopBar, ErrorBox } from "../components/UI";
import { baixarImagem, lerArquivo, reduzirImagem, vazioParaNull } from "./util";
import { capturarPeloLifeGuard, detectarPeloLifeGuard, urlLifeGuard, salvarUrlLifeGuard } from "./lifeguardLocal";

const VAZIO = {
  tipo: "nvr", nome: "", descricao_local: "", gravador_id: "", canal: "", numero_cam: "",
  lg_id: "", porta_lifeguard: "", porta_monitoramento: "", link_provisionamento: "",
  id_cliente_ixc: "", nome_cliente: "", contrato_ixc: "", cidade: "", pppoe: "", ip_pppoe: "", porta_publica: "",
  ip: "", porta: "", mac: "", modelo: "", compressao: "", firmware: "", dias_gravacao: "", status: "desconhecido", observacoes: "",
};
const CAMPOS_DETECTADOS = ["mac", "modelo", "firmware", "compressao"];

function Campo({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

/** Cadastro (cameraId vazio) ou edição de câmera. A foto da documentação é
 * tirada no cadastro; depois ela é atualizada pela ficha da câmera. */
export default function CameraForm({ cameraId, onVoltar, showToast }) {
  const editando = !!cameraId;
  const [form, setForm] = useState(VAZIO);
  const [gravadores, setGravadores] = useState([]);
  const [canaisUsados, setCanaisUsados] = useState([]);
  const [detectados, setDetectados] = useState([]);
  const [foto, setFoto] = useState(null);         // dataURL já reduzida
  const [destino, setDestino] = useState("doc");  // doc | exportar
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [lgUrl, setLgUrl] = useState(urlLifeGuard());

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.get("/ferramentas/gravadores").then(setGravadores).catch((e) => setErro(e.message));
    if (editando) {
      api.get(`/ferramentas/cameras/${cameraId}`).then((c) => {
        const f = { ...VAZIO };
        Object.keys(VAZIO).forEach((k) => { if (c[k] !== null && c[k] !== undefined) f[k] = String(c[k]); });
        setForm(f);
      }).catch((e) => setErro(e.message));
    }
  }, [cameraId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (form.tipo !== "nvr" || !form.gravador_id) { setCanaisUsados([]); return; }
    api.get(`/ferramentas/gravadores/${form.gravador_id}`).then((g) => {
      setCanaisUsados(g.canais_usados || []);
      // NVR externo é de um cliente só: já preenche os dados dele
      if (!editando && g.origem === "cliente") {
        setForm((f) => ({
          ...f,
          nome_cliente: f.nome_cliente || g.nome_cliente || "", contrato_ixc: f.contrato_ixc || g.contrato_ixc || "",
          id_cliente_ixc: f.id_cliente_ixc || g.id_cliente_ixc || "", cidade: f.cidade || g.cidade || "",
          pppoe: f.pppoe || g.pppoe || "", ip_pppoe: f.ip_pppoe || g.ip_pppoe || "",
          dias_gravacao: f.dias_gravacao || (g.dias_gravacao ? String(g.dias_gravacao) : ""),
        }));
      }
    }).catch(() => setCanaisUsados([]));
  }, [form.gravador_id, form.tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravadorSel = gravadores.find((g) => g.id === form.gravador_id);
  const canaisLivres = useMemo(() => {
    const usados = new Set(canaisUsados.filter((c) => !editando || String(c) !== form.canal));
    const livres = [];
    for (let c = 1; c <= 128 && livres.length < 6; c++) if (!usados.has(c)) livres.push(c);
    return livres;
  }, [canaisUsados, editando, form.canal]);
  const canalOcupado = form.tipo === "nvr" && form.canal && canaisUsados.includes(Number(form.canal)) && !editando;

  const alvo = () => ({ tipo: form.tipo, ip: form.ip, porta: form.porta, canal: form.canal ? Number(form.canal) : null, gravador_url: gravadorSel?.url_acesso, lg_id: form.lg_id });

  const detectar = async () => {
    salvarUrlLifeGuard(lgUrl);
    setOcupado("detectar");
    try {
      const r = await detectarPeloLifeGuard(alvo());
      const lidos = CAMPOS_DETECTADOS.filter((k) => r[k]);
      setForm((f) => ({ ...f, ...Object.fromEntries(lidos.map((k) => [k, String(r[k])])) }));
      setDetectados(lidos);
      showToast(lidos.length ? "Dados lidos do equipamento." : "O LifeGuard não conseguiu ler os dados.");
    } catch (e) { showToast(e.message); } finally { setOcupado(""); }
  };

  const capturar = async () => {
    salvarUrlLifeGuard(lgUrl);
    setOcupado("capturar");
    try {
      const r = await capturarPeloLifeGuard(alvo());
      setFoto(await reduzirImagem(`data:image/jpeg;base64,${r.imagem_base64}`));
    } catch (e) { showToast(e.message); } finally { setOcupado(""); }
  };

  const enviarArquivo = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = "";
    if (!arq) return;
    try { setFoto(await reduzirImagem(await lerArquivo(arq))); } catch (err) { showToast(err.message); }
  };

  const salvar = async () => {
    setErro("");
    if (!form.nome.trim()) return setErro("Dê um nome para a câmera.");
    if (form.tipo === "nvr" && (!form.gravador_id || !form.canal)) return setErro("Escolha o gravador e o canal.");
    if (form.tipo === "lifeguard" && !form.lg_id.trim()) return setErro("Informe o ID da câmera LifeGuard.");
    const corpo = vazioParaNull({ ...form });
    corpo.canal = form.tipo === "nvr" ? Number(form.canal) : null;
    corpo.dias_gravacao = form.dias_gravacao ? Number(form.dias_gravacao) : null;
    if (form.tipo === "nvr") { corpo.lg_id = null; } else { corpo.gravador_id = null; }
    setOcupado("salvar");
    try {
      let id = cameraId;
      if (editando) {
        await api.patch(`/ferramentas/cameras/${cameraId}`, corpo);
      } else {
        id = (await api.post("/ferramentas/cameras", corpo)).id;
      }
      if (foto && destino === "doc") {
        try {
          await api.post(`/ferramentas/cameras/${id}/foto`, { imagem_base64: foto });
        } catch (e) {
          showToast(`Câmera salva, mas a foto falhou: ${e.message}`);
          onVoltar(id);
          return;
        }
      }
      if (foto && destino === "exportar") baixarImagem(foto, form.nome);
      showToast(editando ? "Alterações salvas." : foto && destino === "doc" ? "Câmera cadastrada com a foto da documentação." : "Câmera cadastrada.");
      onVoltar(id);
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado("");
    }
  };

  const inp = (k, props = {}) => (
    <input value={form[k]} onChange={set(k)} className={detectados.includes(k) ? "ft-detectado" : ""} {...props} />
  );

  return (
    <>
      <TopBar
        title={editando ? "Editar câmera" : "Nova câmera"}
        subtitle={editando ? form.nome : "O LifeGuard lê os dados do equipamento e tira a foto da documentação no cadastro"}
        right={<button className="btn btn-ghost" onClick={() => onVoltar(cameraId || null)}>← Voltar</button>}
      />
      <div className="content">
        <ErrorBox error={erro} />
        <div className="ft-form-layout">
          <div className="col-a">
            <div className="card">
              <div className="section-title"><span className="ft-passo">1</span>Onde a câmera grava</div>
              <div className="ft-seg" role="group" aria-label="Tipo" style={{ marginBottom: 14 }}>
                <button type="button" className={form.tipo === "nvr" ? "on" : ""} onClick={() => setForm((f) => ({ ...f, tipo: "nvr" }))}>NVR (canal)</button>
                <button type="button" className={form.tipo === "lifeguard" ? "on" : ""} onClick={() => setForm((f) => ({ ...f, tipo: "lifeguard" }))}>LifeGuard (ID)</button>
              </div>
              {form.tipo === "nvr" ? (
                <>
                  <div className="form-grid">
                    <Campo label="Gravador">
                      <select value={form.gravador_id} onChange={set("gravador_id")}>
                        <option value="">Escolha…</option>
                        <optgroup label="NVR Life (instalado na Life)">
                          {gravadores.filter((g) => g.origem === "life").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                        </optgroup>
                        <optgroup label="NVR externo (instalado no cliente)">
                          {gravadores.filter((g) => g.origem === "cliente").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                        </optgroup>
                      </select>
                    </Campo>
                    <Campo label={canaisLivres.length && form.gravador_id ? `Canal (livres: ${canaisLivres.join(", ")}…)` : "Canal"}>
                      <input type="number" min="1" max="512" value={form.canal} onChange={set("canal")} className="mono" />
                    </Campo>
                    <Campo label="Nº da câmera">{inp("numero_cam", { className: "mono" })}</Campo>
                    {gravadorSel?.origem === "life" && <Campo label="Porta pública (no roteador do cliente)">{inp("porta_publica", { className: "mono" })}</Campo>}
                  </div>
                  {canalOcupado && <div className="warn-box" style={{ marginBottom: 0 }}>Esse canal já tem câmera cadastrada neste gravador.</div>}
                </>
              ) : (
                <div className="form-grid">
                  <Campo label="ID da câmera">{inp("lg_id", { className: "mono" })}</Campo>
                  <Campo label="Porta LifeGuard">{inp("porta_lifeguard", { className: "mono" })}</Campo>
                  <Campo label="Porta monitoramento">{inp("porta_monitoramento", { className: "mono" })}</Campo>
                  <Campo label="Link de provisionamento">{inp("link_provisionamento", { className: "mono" })}</Campo>
                </div>
              )}
            </div>

            <div className="card">
              <div className="section-title"><span className="ft-passo">2</span>Cliente e contrato</div>
              <div className="form-grid">
                <Campo label="Contrato IXC">{inp("contrato_ixc", { className: "mono" })}</Campo>
                <Campo label="ID cliente IXC">{inp("id_cliente_ixc", { className: "mono" })}</Campo>
                <Campo label="Cliente">{inp("nome_cliente")}</Campo>
                <Campo label="Cidade">{inp("cidade")}</Campo>
                <Campo label="PPPoE">{inp("pppoe", { className: "mono" })}</Campo>
                <Campo label="IP do PPPoE">{inp("ip_pppoe", { className: "mono" })}</Campo>
              </div>
            </div>

            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <div className="section-title" style={{ margin: 0 }}><span className="ft-passo">3</span>Dados da câmera</div>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!ocupado || !form.ip} onClick={detectar} title={form.ip ? "" : "Preencha o IP da câmera"}>
                  {ocupado === "detectar" ? "Lendo…" : "Detectar pelo LifeGuard"}
                </button>
              </div>
              <div className="form-grid">
                <Campo label="Nome da câmera">{inp("nome")}</Campo>
                <Campo label="Descrição do local">{inp("descricao_local")}</Campo>
              </div>
              <div className="form-grid">
                <Campo label="IP da câmera">{inp("ip", { className: "mono", placeholder: "ex.: 192.168.1.10" })}</Campo>
                <Campo label="Porta">{inp("porta", { className: "mono" })}</Campo>
                <Campo label="MAC">{inp("mac", { className: `mono ${detectados.includes("mac") ? "ft-detectado" : ""}` })}</Campo>
                <Campo label="Modelo">{inp("modelo")}</Campo>
                <Campo label="Firmware">{inp("firmware", { className: `mono ${detectados.includes("firmware") ? "ft-detectado" : ""}` })}</Campo>
                <Campo label="Compressão">
                  <select value={form.compressao} onChange={set("compressao")} className={detectados.includes("compressao") ? "ft-detectado" : ""}>
                    <option value="">—</option><option>H.264</option><option>H.265</option><option>MJPEG</option>
                  </select>
                </Campo>
                <Campo label="Dias de gravação"><input type="number" min="0" value={form.dias_gravacao} onChange={set("dias_gravacao")} /></Campo>
                <Campo label="Situação">
                  <select value={form.status} onChange={set("status")}>
                    <option value="desconhecido">Sem diagnóstico</option><option value="online">Online</option><option value="offline">Offline</option>
                  </select>
                </Campo>
              </div>
              <Campo label="Observações"><textarea value={form.observacoes} onChange={set("observacoes")} /></Campo>
              {detectados.length > 0 && <div className="info-box" style={{ marginTop: 12, marginBottom: 0 }}>Campos em verde foram lidos do equipamento pelo LifeGuard.</div>}
            </div>
          </div>

          <div className="col-b">
            <div className="card">
              {!editando ? (
                <>
                  <div className="section-title"><span className="ft-passo">4</span>Foto da documentação</div>
                  {foto ? (
                    <>
                      <div className="ft-foto"><img src={foto} alt="Imagem capturada da câmera" /></div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }} role="radiogroup" aria-label="O que fazer com a imagem">
                        <button type="button" role="radio" aria-checked={destino === "doc"} className={`ft-opcao ${destino === "doc" ? "on" : ""}`} onClick={() => setDestino("doc")}>
                          <span className="dot" /><span><span className="t">Usar como foto da documentação</span><span className="d">Fica salva no servidor junto com o cadastro.</span></span>
                        </button>
                        <button type="button" role="radio" aria-checked={destino === "exportar"} className={`ft-opcao ${destino === "exportar" ? "on" : ""}`} onClick={() => setDestino("exportar")}>
                          <span className="dot" /><span><span className="t">Só exportar</span><span className="d">Baixa a imagem neste computador e descarta. Nada é salvo.</span></span>
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={!!ocupado} onClick={capturar}>Capturar de novo</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFoto(null)}>Remover</button>
                      </div>
                    </>
                  ) : (
                    <div className="ft-foto-vazia">
                      <span>O LifeGuard captura um quadro da câmera.</span>
                      <button type="button" className="btn btn-primary" disabled={!!ocupado} onClick={capturar}>{ocupado === "capturar" ? "Capturando…" : "Capturar imagem"}</button>
                      <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                        Ou enviar um arquivo
                        <input type="file" accept="image/*" onChange={enviarArquivo} style={{ display: "none" }} />
                      </label>
                    </div>
                  )}
                  <div className="field" style={{ marginTop: 12 }}>
                    <label>Endereço do LifeGuard neste computador</label>
                    <input value={lgUrl} onChange={(e) => setLgUrl(e.target.value)} onBlur={() => salvarUrlLifeGuard(lgUrl)} className="mono" />
                  </div>
                  <div className="info-box" style={{ marginTop: 12 }}>Uma foto por câmera. A imagem é reduzida para 1280 px antes de enviar.</div>
                </>
              ) : (
                <div className="info-box">A foto da documentação é atualizada pela ficha da câmera, no botão "Atualizar foto da documentação".</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", borderTop: "1px solid #EEF0F3", paddingTop: 14, marginTop: 4 }}>
                <button className="btn btn-ghost" onClick={() => onVoltar(cameraId || null)}>Cancelar</button>
                <button className="btn btn-primary" disabled={!!ocupado} onClick={salvar}>
                  {ocupado === "salvar" ? "Salvando…" : editando ? "Salvar alterações" : foto && destino === "doc" ? "Salvar cadastro com foto" : "Salvar cadastro"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
