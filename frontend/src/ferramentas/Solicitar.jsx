import { useState } from "react";
import { api } from "../api/client";
import { lerArquivo, reduzirImagem } from "./util";

export const TIPOS_SOLICITACAO = [
  ["dados", "Dados errados (IP, local, nome…)"],
  ["trocada", "Câmera foi trocada"],
  ["removida", "Câmera foi retirada"],
  ["foto", "Foto nova / desatualizada"],
  ["outro", "Outro"],
];

/** Pedido do técnico para o N2 (tela cheia no celular, janela no computador).
 *  Nada muda na documentação: vira uma solicitação aberta. */
export default function Solicitar({ camera, tipoInicial = "dados", onFechar, onEnviado, showToast }) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const escolherFoto = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = "";
    if (!arq) return;
    try { setFoto(await reduzirImagem(await lerArquivo(arq))); } catch (err) { setErro(err.message); }
  };

  const enviar = async () => {
    setErro("");
    if (!texto.trim() && !foto) { setErro("Escreva o que precisa ser alterado ou anexe uma foto."); return; }
    setEnviando(true);
    try {
      await api.post("/ferramentas/solicitacoes", { camera_id: camera.id, tipo, texto: texto.trim() || null, imagem_base64: foto });
      showToast?.("Enviado para o N2. Você acompanha em \"Meus pedidos\".");
      onEnviado?.();
    } catch (err) { setErro(err.message); } finally { setEnviando(false); }
  };

  return (
    <div className="ft-sol-fundo" role="dialog" aria-modal="true" aria-label="Solicitar alteração">
      <div className="ft-sol">
        <div className="ft-sol-topo">
          <div style={{ minWidth: 0 }}>
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Solicitar alteração</div>
            <div className="ft-ficha-sub">{[camera.nome, camera.descricao_local].filter(Boolean).join(" · ")}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Cancelar</button>
        </div>
        <div className="ft-sol-corpo">
          <div className="ft-sol-rotulo">O que aconteceu?</div>
          <div className="ft-sol-tipos">
            {TIPOS_SOLICITACAO.map(([v, l]) => (
              <button key={v} type="button" className={tipo === v ? "on" : ""} aria-pressed={tipo === v} onClick={() => setTipo(v)}>{l}</button>
            ))}
          </div>
          <label className="ft-sol-rotulo" htmlFor="ft-sol-texto">Detalhe</label>
          <textarea id="ft-sol-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
            placeholder={tipo === "trocada" ? "Modelo, MAC, IP da câmera nova…" : tipo === "removida" ? "Quando e por quê foi retirada…" : "Descreva o que está diferente…"} />
          <div className="ft-sol-rotulo">Foto (opcional)</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {foto && <img src={foto} alt="Foto anexada" style={{ width: 96, height: 64, objectFit: "cover", borderRadius: 8 }} />}
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              {foto ? "Trocar foto" : "📷 Tirar / escolher foto"}
              <input type="file" accept="image/*" capture="environment" onChange={escolherFoto} style={{ display: "none" }} />
            </label>
            {foto && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFoto(null)}>Remover</button>}
          </div>
          {erro && <div className="warn-box" style={{ marginTop: 12, marginBottom: 0 }}>{erro}</div>}
          <div className="ft-sol-aviso">Nada muda na documentação agora: o N2 confere e aplica.</div>
        </div>
        <div className="ft-sol-rodape">
          <button type="button" className="btn btn-primary" disabled={enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar para o N2"}</button>
        </div>
      </div>
    </div>
  );
}
