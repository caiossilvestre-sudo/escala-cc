import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { TopBar, ErrorBox, Pill } from "../components/UI";
import { lerArquivo, reduzirImagem } from "./util";

const POR_ENVIO = 5; // imagens por chamada à API

/** Importação de fotos da documentação em lote.
 *  - Por gravador: arquivos "CANAL 01.jpg", "CANAL 02.jpg"… (formato do
 *    "Exportar frame" do LifeGuard Console) viram o canal daquele NVR.
 *  - Por nome: "<id-da-câmera>.jpg" (coluna id do CSV exportado) ou "LG11157.jpg". */
export default function ImportarFotos({ onVoltar, showToast }) {
  const [modo, setModo] = useState("gravador"); // gravador | nome
  const [gravadores, setGravadores] = useState([]);
  const [gravadorId, setGravadorId] = useState("");
  const [arquivos, setArquivos] = useState([]);   // File[]
  const [mapa, setMapa] = useState([]);           // resposta de /fotos/mapear
  const [substituir, setSubstituir] = useState(false);
  const [progresso, setProgresso] = useState(null); // {feito, total}
  const [resultado, setResultado] = useState({});   // camera_id -> status
  const [erro, setErro] = useState("");

  useEffect(() => { api.get("/ferramentas/gravadores").then(setGravadores).catch((e) => setErro(e.message)); }, []);

  const escolher = async (e) => {
    const lista = [...(e.target.files || [])].filter((f) => /\.(jpe?g|png)$/i.test(f.name));
    e.target.value = "";
    setResultado({});
    setArquivos(lista);
    setMapa([]);
    if (!lista.length) return;
    if (modo === "gravador" && !gravadorId) { setErro("Escolha o gravador antes dos arquivos."); return; }
    setErro("");
    try {
      const m = await api.post("/ferramentas/fotos/mapear", {
        gravador_id: modo === "gravador" ? gravadorId : null,
        nomes: lista.map((f) => f.name),
      });
      setMapa(m);
    } catch (err) { setErro(err.message); }
  };

  const linhas = useMemo(() => mapa.map((m, i) => ({ ...m, arquivo: arquivos[i] })), [mapa, arquivos]);
  const prontas = linhas.filter((l) => l.camera_id && (substituir || !l.tem_foto));
  const semCamera = linhas.filter((l) => !l.camera_id).length;
  const jaTem = linhas.filter((l) => l.camera_id && l.tem_foto).length;

  const importar = async () => {
    setErro("");
    setProgresso({ feito: 0, total: prontas.length });
    const res = {};
    let feito = 0;
    try {
      for (let i = 0; i < prontas.length; i += POR_ENVIO) {
        const bloco = prontas.slice(i, i + POR_ENVIO);
        const itens = [];
        for (const l of bloco) {
          try {
            itens.push({ camera_id: l.camera_id, arquivo: l.nome, imagem_base64: await reduzirImagem(await lerArquivo(l.arquivo)) });
          } catch (_) {
            res[l.camera_id] = { status: "erro", motivo: "Arquivo de imagem inválido" };
          }
        }
        if (itens.length) {
          const r = await api.post("/ferramentas/fotos/lote", { itens, substituir });
          r.forEach((x) => { res[x.camera_id] = x; });
        }
        feito += bloco.length;
        setProgresso({ feito, total: prontas.length });
        setResultado({ ...res });
      }
      const ok = Object.values(res).filter((x) => x.status === "importada" || x.status === "substituida").length;
      showToast(`${ok} foto${ok === 1 ? "" : "s"} importada${ok === 1 ? "" : "s"} na documentação.`);
    } catch (e) {
      setErro(`Parou no meio: ${e.message}. As fotos já enviadas ficaram salvas — pode tentar de novo.`);
    } finally {
      setProgresso(null);
    }
  };

  const statusPill = (l) => {
    const r = resultado[l.camera_id];
    if (r) {
      if (r.status === "importada") return <Pill status="aprovada">Importada</Pill>;
      if (r.status === "substituida") return <Pill status="aprovada">Substituída</Pill>;
      if (r.status === "mantida") return <Pill status="ft-desc">Mantida</Pill>;
      return <Pill status="rejeitada" title={r.motivo}>Erro</Pill>;
    }
    if (!l.camera_id) return <Pill status="rejeitada">Sem câmera</Pill>;
    if (l.tem_foto && !substituir) return <Pill status="ft-desc">Já tem foto — mantém</Pill>;
    if (l.tem_foto) return <Pill status="pendente">Vai substituir</Pill>;
    return <Pill status="plantao">Vai importar</Pill>;
  };

  return (
    <>
      <TopBar title="Importar fotos em lote" subtitle="Leva para a documentação as imagens geradas fora do sistema" right={<button className="btn btn-ghost" onClick={onVoltar}>← Voltar</button>} />
      <div className="content">
        <ErrorBox error={erro} />

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title"><span className="ft-passo">1</span>Como os arquivos estão nomeados</div>
          <div className="ft-seg" role="group" aria-label="Modo" style={{ marginBottom: 12 }}>
            <button type="button" className={modo === "gravador" ? "on" : ""} onClick={() => { setModo("gravador"); setMapa([]); setArquivos([]); }}>Por gravador (CANAL 01.jpg…)</button>
            <button type="button" className={modo === "nome" ? "on" : ""} onClick={() => { setModo("nome"); setMapa([]); setArquivos([]); }}>Por id da câmera / LG</button>
          </div>
          {modo === "gravador" ? (
            <div className="form-grid" style={{ marginBottom: 0 }}>
              <div className="field">
                <label>Gravador</label>
                <select value={gravadorId} onChange={(e) => { setGravadorId(e.target.value); setMapa([]); setArquivos([]); }}>
                  <option value="">Escolha…</option>
                  <optgroup label="NVR Life (instalado na Life)">
                    {gravadores.filter((g) => g.origem === "life").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </optgroup>
                  <optgroup label="NVR externo (instalado no cliente)">
                    {gravadores.filter((g) => g.origem === "cliente").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>
          ) : (
            <div className="info-box" style={{ marginBottom: 0 }}>
              Use o arquivo com o <b>id</b> da câmera (coluna "id" ou "arquivo_sugerido" do CSV exportado), ex.: <span className="mono">3f2a…c91.jpg</span>, ou <span className="mono">LG11157.jpg</span> para câmeras LifeGuard.
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title"><span className="ft-passo">2</span>Escolher as imagens</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="btn btn-primary" style={{ cursor: "pointer" }}>
              Escolher arquivos
              <input type="file" accept="image/jpeg,image/png" multiple onChange={escolher} style={{ display: "none" }} />
            </label>
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              Escolher uma pasta
              <input type="file" webkitdirectory="" directory="" multiple onChange={escolher} style={{ display: "none" }} />
            </label>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Se veio em .zip, extraia antes. As imagens são reduzidas para 1280 px antes de enviar.</span>
          </div>
        </div>

        {linhas.length > 0 && (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0 }}><span className="ft-passo">3</span>Conferir e importar</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 600 }}>
                  <input type="checkbox" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} disabled={!!progresso} />
                  Substituir fotos que já existem
                </label>
                <button className="btn btn-primary" disabled={!!progresso || prontas.length === 0} onClick={importar}>
                  {progresso ? `Importando ${progresso.feito}/${progresso.total}…` : `Importar ${prontas.length} foto${prontas.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              {linhas.length} arquivo{linhas.length === 1 ? "" : "s"} · {linhas.length - semCamera} com câmera encontrada · {semCamera} sem câmera · {jaTem} já com foto
            </div>
            <div className="ft-tabela-wrap">
              <table className="tbl">
                <thead><tr><th>Arquivo</th><th>Câmera</th><th>Situação</th></tr></thead>
                <tbody>{linhas.map((l, i) => (
                  <tr key={`${l.nome}-${i}`}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{l.nome}</td>
                    <td>{l.camera_nome ? <>{l.camera_nome}{l.canal ? <span style={{ color: "var(--text-muted)" }}> · canal {l.canal}</span> : null}</> : <span style={{ color: "var(--text-muted)" }}>{l.motivo}</span>}</td>
                    <td>{statusPill(l)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
