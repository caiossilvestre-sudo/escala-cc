import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Pill } from "../components/UI";
import { TIPO_INFO, STATUS_INFO, tipoDe, origemTexto, linkNvr, dataHora, kb, baixarImagem, lerArquivo, reduzirImagem } from "./util";

function Campos({ itens }) {
  const visiveis = itens.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (visiveis.length === 0) return <div className="ft-vazio">Nada preenchido.</div>;
  return (
    <dl className="ft-dl">
      {visiveis.map(([k, v, mono, largo]) => (
        <div key={k} className={largo ? "largo" : ""}><dt>{k}</dt><dd className={mono ? "mono" : ""}>{String(v)}</dd></div>
      ))}
    </dl>
  );
}

function Linha({ titulo, children }) {
  return (
    <div className="ft-quadro-linha">
      <div className="ft-quadro-titulo">{titulo}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Ficha da câmera (painel lateral): foto da documentação, dados e acessos. */
export default function CameraFicha({ cameraId, onEditar, onSubstituir, onMudou, showToast, confirm }) {
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

  if (erro) return <div style={{ padding: 18 }}><div className="warn-box">{erro}</div></div>;
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
    const canal = cam.tipo === "nvr";
    const msg = canal
      ? `O canal ${cam.canal ?? ""} fica livre e "${cam.nome}" sai da documentação junto com a foto. Isso não pode ser desfeito. Se a câmera só foi trocada, use "Substituir câmera".`
      : `"${cam.nome}" e a foto da documentação serão apagados. Isso não pode ser desfeito.`;
    if (!(await confirm(msg, { title: canal ? "Liberar o canal?" : "Excluir câmera?", confirmLabel: canal ? "Liberar canal" : "Excluir" }))) return;
    try {
      await api.delete(`/ferramentas/cameras/${cam.id}`);
      showToast("Câmera excluída.");
      onMudou?.(true);
    } catch (e) { showToast(e.message); }
  };

  const g = cam.gravador;
  return (
    <div className="ft-ficha">
      <div className="ft-ficha-topo">
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Pill status={tipo.pill} title={tipo.dica}>{tipo.label}</Pill>
            {cam.status !== "desconhecido" && <Pill status={st.pill}>{st.label}</Pill>}
            <span className="ft-origem-txt">{origemTexto(cam)}</span>
          </div>
          <div className="display ft-ficha-nome">{cam.nome}</div>
          <div className="ft-ficha-sub">{[cam.descricao_local, cam.nome_cliente].filter(Boolean).join(" · ") || "—"}</div>
          {g && (linkNvr(g.url_acesso) || linkNvr(g.url_https, "https")) && (
            <div className="ft-nvr-links">
              {linkNvr(g.url_acesso) && <a href={linkNvr(g.url_acesso)} target="_blank" rel="noopener noreferrer">↗ Abrir NVR</a>}
              {linkNvr(g.url_https, "https") && <a href={linkNvr(g.url_https, "https")} target="_blank" rel="noopener noreferrer">↗ HTTPS</a>}
            </div>
          )}
        </div>
        <div className="ft-ficha-botoes">
          {cam.pode_editar && (
            <label className={`btn btn-primary btn-sm ${enviando ? "disabled" : ""}`} style={{ cursor: enviando ? "wait" : "pointer" }}>
              {enviando ? "Importando…" : cam.tem_foto ? "Substituir foto" : "Importar foto"}
              <input type="file" accept="image/*" onChange={importarFoto} disabled={enviando} style={{ display: "none" }} />
            </label>
          )}
          {cam.pode_editar && <button className="btn btn-ghost btn-sm" onClick={() => onEditar(cam.id)}>Editar</button>}
          {cam.pode_editar && cam.tipo === "nvr" && onSubstituir && <button className="btn btn-ghost btn-sm" onClick={() => onSubstituir(cam.id)} title="A câmera do canal foi trocada">Substituir câmera</button>}
          {cam.pode_excluir && <button className="btn btn-danger btn-sm" onClick={excluir}>{cam.tipo === "nvr" ? "Liberar canal" : "Excluir"}</button>}
        </div>
      </div>

      <div className="ft-ficha-corpo">
        {cam.tem_foto ? (
          <div>
            <div className="ft-foto">
              {foto ? <img src={foto} alt={`Imagem da câmera ${cam.nome}`} /> : <div className="empty" style={{ color: "#9AA2B8" }}>{carregandoFoto ? "Carregando foto…" : "Foto indisponível"}</div>}
            </div>
            <div className="ft-legenda">
              <span>Registrada em {dataHora(cam.foto_em)}{cam.foto_por_nome ? ` por ${cam.foto_por_nome}` : ""}{cam.foto_bytes ? ` · ${kb(cam.foto_bytes)}` : ""}</span>
              {foto && <button type="button" className="ft-link" onClick={() => baixarImagem(foto, `${cam.nome}_documentacao`)}>Exportar foto</button>}
            </div>
          </div>
        ) : (
          <div className="ft-foto-vazia">Sem foto de documentação{cam.pode_editar ? " — use \"Importar foto\" acima." : "."}</div>
        )}

        <div className="ft-quadro">
          {cam.tipo === "lifeguard" ? (
            <Linha titulo="LifeGuard">
              <Campos itens={[["ID da câmera", cam.lg_id, true], ["Porta LifeGuard", cam.porta_lifeguard, true], ["Porta monitoramento", cam.porta_monitoramento, true], ["Dias de gravação", cam.dias_gravacao && `${cam.dias_gravacao} dias`], ["Link de provisionamento", cam.link_provisionamento, true, true]]} />
            </Linha>
          ) : (
            <Linha titulo="Gravador">
              <Campos itens={[["Gravador", g?.nome], ["Canal", cam.canal, true], ["Instalado", g?.origem === "cliente" ? "No cliente (NVR externo)" : "Na Life (NVR Life)"], ["Acesso ao NVR", g?.url_acesso, true, true], ["Nº câmera", cam.numero_cam, true], ["Porta de serviço", g?.porta_servico, true], ["Porta pública", cam.porta_publica, true], ["Dias de gravação", (cam.dias_gravacao || g?.dias_gravacao) && `${cam.dias_gravacao || g?.dias_gravacao} dias`]]} />
            </Linha>
          )}
          <Linha titulo="Cliente">
            <Campos itens={[["Cliente", cam.nome_cliente, false, true], ["Contrato", cam.contrato_ixc, true], ["Cidade", cam.cidade], ["ID cliente IXC", cam.id_cliente_ixc, true], ["PPPoE", cam.pppoe, true], ["IP do PPPoE", cam.ip_pppoe, true]]} />
          </Linha>
          <Linha titulo="Rede">
            <Campos itens={[["IP da câmera", cam.ip && `${cam.ip}${cam.porta ? `:${cam.porta}` : ""}`, true], ["MAC", cam.mac, true], ["Modelo", cam.modelo], ["Firmware", cam.firmware, true], ["Compressão", cam.compressao], ["Última edição", cam.atualizado_por_nome ? `${cam.atualizado_por_nome} · ${dataHora(cam.atualizado_em)}` : dataHora(cam.atualizado_em), false, true]]} />
          </Linha>
          {cam.observacoes && (
            <Linha titulo="Observações">
              <div style={{ fontSize: 12, whiteSpace: "pre-line" }}>{cam.observacoes}</div>
            </Linha>
          )}
          <Linha titulo="Acessos">
            {cam.credenciais.length === 0 ? <div className="ft-vazio">{cam.tipo === "lifeguard" ? "Câmera LifeGuard — sem acesso de gravador." : "Nenhum usuário cadastrado."}</div> : (
              <>
                <div className="ft-creds">
                  {cam.credenciais.map((c) => (
                    <span key={c.id} className="ft-cred mono">
                      <span title={c.de === "gravador" && !c.nome_cliente ? "Usuário geral do NVR" : undefined}>{c.usuario}</span>
                      <span className="s">{senhas[c.id] !== undefined ? senhas[c.id] : c.tem_senha ? "••••••" : "(sem senha)"}</span>
                      {cam.pode_ver_senhas && c.tem_senha && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => revelar(c.id)}>{senhas[c.id] !== undefined ? "Ocultar" : "Mostrar"}</button>
                      )}
                    </span>
                  ))}
                </div>
                {cam.pode_ver_senhas && <div className="ft-vazio" style={{ marginTop: 5 }}>A senha some em 30 s e cada visualização fica registrada.</div>}
              </>
            )}
          </Linha>
        </div>
      </div>
    </div>
  );
}
