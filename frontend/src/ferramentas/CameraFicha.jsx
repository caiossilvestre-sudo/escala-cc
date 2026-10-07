import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Pill } from "../components/UI";
import { TIPO_INFO, STATUS_INFO, tipoDe, dataHora, kb, baixarImagem, lerArquivo, reduzirImagem } from "./util";

function Campos({ itens }) {
  const visiveis = itens.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (visiveis.length === 0) return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Nada preenchido.</div>;
  return (
    <dl className="ft-dl">
      {visiveis.map(([k, v, mono]) => (
        <div key={k}><dt>{k}</dt><dd className={mono ? "mono" : ""}>{String(v)}</dd></div>
      ))}
    </dl>
  );
}

/** Ficha da câmera (painel lateral): foto da documentação, dados e acessos. */
export default function CameraFicha({ cameraId, onEditar, onMudou, showToast, confirm }) {
  const [cam, setCam] = useState(null);
  const [erro, setErro] = useState("");
  const [foto, setFoto] = useState(null);
  const [carregandoFoto, setCarregandoFoto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [senhas, setSenhas] = useState({});
  const timers = useRef({});

  const carregar = () => {
    setErro("");
    api.get(`/ferramentas/cameras/${cameraId}`).then((c) => {
      setCam(c);
      if (c.tem_foto) {
        setCarregandoFoto(true);
        api.get(`/ferramentas/cameras/${cameraId}/foto`)
          .then((f) => setFoto(`data:${f.mime};base64,${f.imagem_base64}`))
          .catch(() => setFoto(null))
          .finally(() => setCarregandoFoto(false));
      } else {
        setFoto(null);
      }
    }).catch((e) => setErro(e.message));
  };

  useEffect(() => {
    setCam(null); setFoto(null); setSenhas({});
    carregar();
    return () => Object.values(timers.current).forEach(clearTimeout);
  }, [cameraId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <div className="ft-sec"><div className="warn-box">{erro}</div></div>;
  if (!cam) return <div className="empty">Carregando…</div>;

  const tipo = TIPO_INFO[tipoDe(cam)];
  const st = STATUS_INFO[cam.status] || STATUS_INFO.desconhecido;
  // Importa a foto de um arquivo escolhido (o sistema não captura nada sozinho)
  const importarFoto = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = "";
    if (!arq) return;
    if (cam.tem_foto && !(await confirm("A foto atual da documentação será substituída pela imagem escolhida.", { title: "Substituir a foto?", confirmLabel: "Substituir", danger: false }))) return;
    setEnviando(true);
    try {
      const dataUrl = await reduzirImagem(await lerArquivo(arq));
      await api.post(`/ferramentas/cameras/${cam.id}/foto`, { imagem_base64: dataUrl });
      showToast("Foto da documentação importada.");
      carregar();
      onMudou?.();
    } catch (err) {
      showToast(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const revelar = async (credId) => {
    if (senhas[credId] !== undefined) {
      setSenhas((s) => { const n = { ...s }; delete n[credId]; return n; });
      return;
    }
    try {
      const r = await api.post(`/ferramentas/credenciais/${credId}/revelar`);
      setSenhas((s) => ({ ...s, [credId]: r.senha ?? "(sem senha)" }));
      clearTimeout(timers.current[credId]);
      timers.current[credId] = setTimeout(() => setSenhas((s) => { const n = { ...s }; delete n[credId]; return n; }), 30000);
    } catch (e) { showToast(e.message); }
  };

  const excluir = async () => {
    if (!(await confirm(`"${cam.nome}" e a foto da documentação serão apagados. Isso não pode ser desfeito.`, { title: "Excluir câmera?", confirmLabel: "Excluir" }))) return;
    try {
      await api.delete(`/ferramentas/cameras/${cam.id}`);
      showToast("Câmera excluída.");
      onMudou?.(true);
    } catch (e) { showToast(e.message); }
  };

  const g = cam.gravador;
  return (
    <>
      <div className="ft-sec">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Pill status={tipo.pill} title={tipo.dica}>{tipo.label}</Pill>
          {cam.status !== "desconhecido" && <Pill status={st.pill}>{st.label}</Pill>}
        </div>
        <div className="display" style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{cam.nome}</div>
        <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 2 }}>
          {[cam.descricao_local, cam.nome_cliente].filter(Boolean).join(" · ") || "—"}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {cam.pode_editar && <button className="btn btn-ghost btn-sm" onClick={() => onEditar(cam.id)}>Editar dados</button>}
          {cam.pode_excluir && <button className="btn btn-danger btn-sm" onClick={excluir}>Excluir</button>}
        </div>
      </div>

      <div className="ft-sec">
        <h3>Foto da documentação</h3>
        {cam.tem_foto ? (
          <>
            <div className="ft-foto">
              {foto ? <img src={foto} alt={`Imagem da câmera ${cam.nome}`} /> : <div className="empty" style={{ color: "#9AA2B8" }}>{carregandoFoto ? "Carregando foto…" : "Foto indisponível"}</div>}
            </div>
            <div className="ft-legenda">Registrada em {dataHora(cam.foto_em)}{cam.foto_por_nome ? ` por ${cam.foto_por_nome}` : ""}{cam.foto_bytes ? ` · ${kb(cam.foto_bytes)}` : ""}</div>
          </>
        ) : (
          <div className="ft-foto-vazia">
            <span>Esta câmera ainda não tem foto de documentação.</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {cam.pode_editar && (
            <label className={`btn btn-primary btn-sm ${enviando ? "disabled" : ""}`} style={{ cursor: enviando ? "wait" : "pointer" }}>
              {enviando ? "Importando…" : cam.tem_foto ? "Substituir foto (importar arquivo)" : "Importar foto"}
              <input type="file" accept="image/*" onChange={importarFoto} disabled={enviando} style={{ display: "none" }} />
            </label>
          )}
          {foto && <button className="btn btn-ghost btn-sm" onClick={() => baixarImagem(foto, `${cam.nome}_documentacao`)}>Exportar foto</button>}
        </div>
        <div className="info-box" style={{ marginTop: 10, marginBottom: 0 }}>
          Uma foto por câmera. Importar uma nova substitui a anterior.
        </div>
      </div>

      <div className="ft-sec">
        <h3>{cam.tipo === "lifeguard" ? "LifeGuard" : "Gravador"}</h3>
        {cam.tipo === "lifeguard" ? (
          <Campos itens={[["ID da câmera", cam.lg_id, true], ["Porta LifeGuard", cam.porta_lifeguard, true], ["Porta monitoramento", cam.porta_monitoramento, true], ["Dias de gravação", cam.dias_gravacao && `${cam.dias_gravacao} dias`], ["Link de provisionamento", cam.link_provisionamento, true]]} />
        ) : (
          <Campos itens={[["Gravador", g?.nome], ["Instalado", g?.origem === "cliente" ? "No cliente (NVR externo)" : "Na Life (NVR Life)"], ["Canal", cam.canal, true], ["Nº câmera", cam.numero_cam, true], ["Acesso ao NVR", g?.url_acesso, true], ["Porta de serviço", g?.porta_servico, true], ["Porta pública", cam.porta_publica, true], ["Dias de gravação", (cam.dias_gravacao || g?.dias_gravacao) && `${cam.dias_gravacao || g?.dias_gravacao} dias`]]} />
        )}
      </div>

      <div className="ft-sec">
        <h3>Cliente</h3>
        <Campos itens={[["Cliente", cam.nome_cliente], ["Contrato IXC", cam.contrato_ixc, true], ["ID cliente IXC", cam.id_cliente_ixc, true], ["Cidade", cam.cidade], ["PPPoE", cam.pppoe, true], ["IP do PPPoE", cam.ip_pppoe, true]]} />
      </div>

      <div className="ft-sec">
        <h3>Rede e equipamento</h3>
        <Campos itens={[["IP da câmera", cam.ip && `${cam.ip}${cam.porta ? `:${cam.porta}` : ""}`, true], ["MAC", cam.mac, true], ["Modelo", cam.modelo], ["Compressão", cam.compressao], ["Firmware", cam.firmware, true], ["Última edição", cam.atualizado_por_nome ? `${cam.atualizado_por_nome} · ${dataHora(cam.atualizado_em)}` : dataHora(cam.atualizado_em)]]} />
        {cam.observacoes && <div className="warn-box" style={{ marginTop: 12, marginBottom: 0, whiteSpace: "pre-line" }}>{cam.observacoes}</div>}
      </div>

      <div className="ft-sec">
        <h3>
          Acessos
          <Pill status="pendente">{cam.pode_ver_senhas ? "Você pode ver as senhas" : "Senhas: permissão própria"}</Pill>
        </h3>
        {cam.credenciais.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Nenhum usuário cadastrado.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cam.credenciais.map((c) => (
              <div key={c.id} className="ft-cred">
                <span className="u mono">{c.usuario}{c.de === "gravador" && !c.nome_cliente ? <span style={{ color: "var(--text-muted)", fontFamily: "Inter, sans-serif" }}> · geral do NVR</span> : null}</span>
                <span className="s mono">{senhas[c.id] !== undefined ? senhas[c.id] : c.tem_senha ? "••••••••••" : "(sem senha)"}</span>
                {cam.pode_ver_senhas && c.tem_senha && (
                  <button className="btn btn-ghost btn-sm" onClick={() => revelar(c.id)}>{senhas[c.id] !== undefined ? "Ocultar" : "Mostrar"}</button>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>A senha some sozinha em 30 s. Cada visualização fica registrada no log de auditoria.</div>
      </div>
    </>
  );
}
