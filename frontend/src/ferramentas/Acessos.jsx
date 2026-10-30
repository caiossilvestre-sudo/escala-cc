import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { ErrorBox, Spinner, Toast, ConfirmModal, TopBar } from "../components/UI";
import { useToast, useConfirm } from "../lib/hooks";
import { dataHora } from "./util";
import "./ferramentas.css";

const SOME_EM = 30000; // senha mostrada some e a área de transferência é limpa em 30 s

const semAcento = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Link pronto para abrir ("10.0.0.1:8080" vira "http://10.0.0.1:8080"). */
function href(link) {
  const u = (link || "").trim();
  if (!u) return null;
  return /^[a-z]+:\/\//i.test(u) ? u : `http://${u}`;
}

async function copiarSenhaTemporaria(senha) {
  await navigator.clipboard.writeText(senha);
  setTimeout(() => {
    navigator.clipboard.readText?.()
      .then((atual) => { if (atual === senha) navigator.clipboard.writeText(""); })
      .catch(() => navigator.clipboard.writeText("").catch(() => {}));
  }, SOME_EM);
}

// ----------------------------------------------------------- modais simples

function Modal({ titulo, onFechar, children }) {
  return (
    <div className="ft-gaveta-fundo" style={{ justifyContent: "center", alignItems: "center" }} onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="card ac-modal" role="dialog" aria-label={titulo}>
        <div className="ac-modal-topo"><h3>{titulo}</h3><button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function ItemForm({ item, secoes, secaoPadrao, onFechar, onSalvo, showToast }) {
  const novo = !item?.id;
  const [f, setF] = useState({
    secao_id: item?.secao_id || secaoPadrao || secoes[0]?.id || "",
    nome: item?.nome || "", link: item?.link || "", descricao: item?.descricao || "",
  });
  const [salvando, setSalvando] = useState(false);
  const muda = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const salvar = async (e) => {
    e.preventDefault();
    if (!f.nome.trim()) { showToast("Informe o nome."); return; }
    setSalvando(true);
    try {
      const corpo = { secao_id: f.secao_id, nome: f.nome, link: f.link || null, descricao: f.descricao || null };
      const r = novo ? await api.post("/ferramentas/acessos/itens", corpo) : await api.patch(`/ferramentas/acessos/itens/${item.id}`, corpo);
      showToast(novo ? "Item incluído." : "Alterações salvas.");
      onSalvo(novo ? r.id : item.id);
    } catch (err) { showToast(err.message); } finally { setSalvando(false); }
  };
  return (
    <Modal titulo={novo ? "Novo item" : "Editar item"} onFechar={onFechar}>
      <form onSubmit={salvar} className="ac-form" autoComplete="off">
        <label>Seção
          <select className="ft-input" value={f.secao_id} onChange={muda("secao_id")}>
            {secoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </label>
        <label>Nome *<input className="ft-input" autoFocus value={f.nome} onChange={muda("nome")} maxLength={150} placeholder="Ex.: IXC, Roteador Intelbras W5, Cliente X" /></label>
        <label>Link <span className="ac-opc">opcional</span><input className="ft-input" value={f.link} onChange={muda("link")} maxLength={1000} placeholder="https://… ou 10.0.0.1:8080" /></label>
        <label>Descrição <span className="ac-opc">opcional</span><textarea className="ft-input" rows={2} value={f.descricao} onChange={muda("descricao")} maxLength={1000} /></label>
        <div className="ac-form-rodape">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Secoes({ secoes, onFechar, onMudou, showToast, confirm }) {
  const [nova, setNova] = useState({ nome: "", tipo: "links" });
  const [editando, setEditando] = useState(null); // { id, nome }
  const [ocupado, setOcupado] = useState(false);
  const fazer = async (fn, msg) => {
    setOcupado(true);
    try { await fn(); if (msg) showToast(msg); onMudou(); } catch (e) { showToast(e.message); } finally { setOcupado(false); }
  };
  const mover = (i, d) => {
    const lista = [...secoes];
    const [s] = lista.splice(i, 1);
    lista.splice(i + d, 0, s);
    fazer(() => Promise.all(lista.map((x, k) => (x.ordem === k + 1 ? null : api.patch(`/ferramentas/acessos/secoes/${x.id}`, { ordem: k + 1 })))));
  };
  return (
    <Modal titulo="Seções" onFechar={onFechar}>
      <div className="ac-secoes">
        {secoes.map((s, i) => (
          <div key={s.id} className="ac-secoes-linha">
            <div className="ac-ordem">
              <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado || i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado || i === secoes.length - 1} onClick={() => mover(i, 1)} aria-label="Descer">↓</button>
            </div>
            {editando?.id === s.id ? (
              <form style={{ display: "flex", gap: 6, flex: 1 }} onSubmit={(e) => { e.preventDefault(); fazer(() => api.patch(`/ferramentas/acessos/secoes/${s.id}`, { nome: editando.nome }), "Seção renomeada.").then(() => setEditando(null)); }}>
                <input className="ft-input" autoFocus value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} maxLength={80} />
                <button className="btn btn-primary btn-sm" disabled={ocupado}>Salvar</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando(null)}>Cancelar</button>
              </form>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{s.nome}</b> <span className="ac-opc">{s.itens.length} {s.itens.length === 1 ? "item" : "itens"}</span>
                </div>
                <select className="ft-input" style={{ flex: "0 0 auto", width: 150 }} value={s.tipo} disabled={ocupado}
                  onChange={(e) => fazer(() => api.patch(`/ferramentas/acessos/secoes/${s.id}`, { tipo: e.target.value }))}
                  title="Equipamentos mostra usuários possíveis + senhas para tentar">
                  <option value="links">Links / sistemas</option>
                  <option value="equipamentos">Equipamentos</option>
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando({ id: s.id, nome: s.nome })}>Renomear</button>
                <button type="button" className="btn btn-danger btn-sm" disabled={ocupado || s.itens.length > 0}
                  title={s.itens.length ? "Mova ou exclua os itens antes" : "Excluir seção"}
                  onClick={async () => { if (await confirm(`Excluir a seção "${s.nome}"?`, { title: "Excluir seção?", confirmLabel: "Excluir", danger: true })) fazer(() => api.delete(`/ferramentas/acessos/secoes/${s.id}`), "Seção excluída."); }}>Excluir</button>
              </>
            )}
          </div>
        ))}
      </div>
      <form className="ac-secoes-nova" onSubmit={(e) => { e.preventDefault(); if (!nova.nome.trim()) return; fazer(() => api.post("/ferramentas/acessos/secoes", nova), "Seção criada.").then(() => setNova({ nome: "", tipo: "links" })); }}>
        <input className="ft-input" placeholder="Nova seção" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} maxLength={80} />
        <select className="ft-input" style={{ flex: "0 0 auto", width: 150 }} value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value })}>
          <option value="links">Links / sistemas</option>
          <option value="equipamentos">Equipamentos</option>
        </select>
        <button className="btn btn-primary btn-sm" disabled={ocupado || !nova.nome.trim()}>+ Criar</button>
      </form>
    </Modal>
  );
}

// -------------------------------------------------------- linha de acesso

function CredForm({ inicial, equip, modo, onSalvar, onCancelar }) {
  // modo: "usuario" (só usuário), "senha" (senha + obs), "login" (usuário + senha + obs)
  const [f, setF] = useState({ usuario: inicial?.usuario || "", senha: "", rotulo: inicial?.rotulo || "" });
  const [trocar, setTrocar] = useState(!inicial || !inicial.tem_senha);
  const [ver, setVer] = useState(false);
  const muda = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const mostraUsuario = modo !== "senha" || (inicial && inicial.usuario);
  const mostraSenha = modo !== "usuario";
  const enviar = (e) => {
    e.preventDefault();
    const corpo = {};
    if (mostraUsuario) corpo.usuario = f.usuario || null;
    if (mostraSenha && trocar) corpo.senha = f.senha;
    if (modo !== "usuario") corpo.rotulo = f.rotulo || null;
    onSalvar(corpo);
  };
  return (
    <form className="ac-cred-form" onSubmit={enviar} autoComplete="off">
      {mostraUsuario && <input className="ft-input" autoFocus placeholder={modo === "usuario" ? "Usuário" : "Usuário (opcional)"} value={f.usuario} onChange={muda("usuario")} maxLength={150} />}
      {mostraSenha && (trocar ? (
        <div style={{ display: "flex", gap: 6, flex: "1 1 200px" }}>
          <input className="ft-input" autoFocus={!mostraUsuario} type={ver ? "text" : "password"} autoComplete="new-password" placeholder={inicial?.tem_senha ? "Nova senha (vazio apaga)" : "Senha"} value={f.senha} onChange={muda("senha")} maxLength={300} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVer((v) => !v)}>{ver ? "Ocultar" : "Ver"}</button>
        </div>
      ) : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTrocar(true)}>Trocar senha</button>)}
      {modo !== "usuario" && <input className="ft-input" placeholder={equip ? "Modelo / observação (opcional)" : "Observação (ex.: usuário do N2)"} value={f.rotulo} onChange={muda("rotulo")} maxLength={150} />}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-primary btn-sm">Salvar</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- ficha (gaveta)

function Ficha({ itemId, secoes, onFechar, onMudou, showToast, confirm }) {
  const [it, setIt] = useState(null);
  const [erro, setErro] = useState("");
  const [reveladas, setReveladas] = useState({});
  const [editandoCred, setEditandoCred] = useState(null); // id
  const [incluindo, setIncluindo] = useState(null); // "usuario" | "senha" | "login"
  const [editandoItem, setEditandoItem] = useState(false);
  const timers = useRef({});

  const carregar = useCallback(() => {
    api.get(`/ferramentas/acessos/itens/${itemId}`).then(setIt).catch((e) => setErro(e.message));
  }, [itemId]);
  useEffect(() => { setIt(null); setReveladas({}); setEditandoCred(null); setIncluindo(null); carregar(); }, [carregar]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const esconder = (id) => setReveladas((r) => { const n = { ...r }; delete n[id]; return n; });
  const buscar = async (id) => (await api.post(`/ferramentas/acessos/credenciais/${id}/revelar`)).senha ?? "";
  const alternar = async (c) => {
    if (reveladas[c.id] !== undefined) { esconder(c.id); return; }
    try {
      const s = await buscar(c.id);
      setReveladas((r) => ({ ...r, [c.id]: s }));
      clearTimeout(timers.current[c.id]);
      timers.current[c.id] = setTimeout(() => esconder(c.id), SOME_EM);
    } catch (e) { showToast(e.message); }
  };
  const copiar = async (c) => {
    try {
      const s = reveladas[c.id] !== undefined ? reveladas[c.id] : await buscar(c.id);
      await copiarSenhaTemporaria(s);
      showToast("Senha copiada — a área de transferência é limpa em 30 s.");
    } catch (e) { showToast(e.message || "Não foi possível copiar."); }
  };
  const copiarTexto = (t) => navigator.clipboard.writeText(t).then(() => showToast("Usuário copiado.")).catch(() => showToast("Não foi possível copiar."));

  const salvarCred = async (corpo, c) => {
    try {
      if (c) await api.patch(`/ferramentas/acessos/credenciais/${c.id}`, corpo);
      else await api.post(`/ferramentas/acessos/itens/${itemId}/credenciais`, corpo);
      showToast(c ? "Alteração salva." : "Incluído.");
      setEditandoCred(null); setIncluindo(null); esconder(c?.id);
      carregar(); onMudou();
    } catch (e) { showToast(e.message); }
  };
  const excluirCred = async (c) => {
    if (!(await confirm(`${c.tem_senha ? "Esta senha" : `O usuário "${c.usuario}"`} sai da lista para todo o setor.${c.minha ? "" : ` Foi incluído por ${c.criado_por_nome || "outra pessoa"}.`}`, { title: "Excluir?", confirmLabel: "Excluir", danger: true }))) return;
    try { await api.delete(`/ferramentas/acessos/credenciais/${c.id}`); showToast("Excluído."); carregar(); onMudou(); } catch (e) { showToast(e.message); }
  };
  const excluirItem = async () => {
    if (!(await confirm(`"${it.nome}" e os acessos dele saem da lista para todo o setor.`, { title: "Excluir item?", confirmLabel: "Excluir", danger: true }))) return;
    try { await api.delete(`/ferramentas/acessos/itens/${it.id}`); showToast("Item excluído."); onMudou(); onFechar(); } catch (e) { showToast(e.message); }
  };

  const equip = it?.secao_tipo === "equipamentos";
  const usuariosSoltos = it ? it.credenciais.filter((c) => !c.tem_senha) : [];
  const comSenha = it ? it.credenciais.filter((c) => c.tem_senha) : [];

  const acoes = (c) => (c.pode_editar ? (
    <span className="ac-acoes">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditandoCred(c.id)}>Editar</button>
      <button type="button" className="btn btn-ghost btn-sm ac-x" onClick={() => excluirCred(c)} aria-label="Excluir">✕</button>
    </span>
  ) : <span className="ac-cadeado" title="Só quem incluiu ou um administrador pode alterar">🔒</span>);

  const linhaSenha = (c, n) => (editandoCred === c.id ? (
    <div key={c.id} className="ac-linha"><CredForm inicial={c} equip={equip} modo={equip ? "senha" : "login"} onSalvar={(b) => salvarCred(b, c)} onCancelar={() => setEditandoCred(null)} /></div>
  ) : (
    <div key={c.id} className="ac-linha">
      {n && <span className="ac-n">{n}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ac-cred">
          {c.usuario && <button type="button" className="ac-chip" title="Copiar usuário" onClick={() => copiarTexto(c.usuario)}>{c.usuario} ⧉</button>}
          <span className="ac-senha">{reveladas[c.id] !== undefined ? (reveladas[c.id] || "(vazia)") : "••••••••"}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => alternar(c)}>{reveladas[c.id] !== undefined ? "Ocultar" : "Mostrar"}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copiar(c)}>Copiar</button>
        </div>
        <div className="ac-autor">{c.rotulo && <b>{c.rotulo} · </b>}{c.minha ? "Você" : c.criado_por_nome || "—"}</div>
      </div>
      {acoes(c)}
    </div>
  ));

  return (
    <div className="ft-gaveta-fundo" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <aside className="ft-gaveta ac-gaveta" aria-label="Acessos do item">
        <ErrorBox error={erro} />
        {!it ? <Spinner /> : (
          <>
            <div className="ac-g-topo">
              <div style={{ minWidth: 0 }}>
                <div className="ac-g-sec">{it.secao_nome}</div>
                <div className="ac-g-nome">{it.nome}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>✕</button>
            </div>
            {(it.link || it.descricao || it.pode_editar) && (
              <div className="ac-g-bloco">
                {it.descricao && <div className="ac-g-desc">{it.descricao}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: it.descricao ? 8 : 0 }}>
                  {it.link && <a className="btn btn-primary btn-sm" href={href(it.link)} target="_blank" rel="noopener noreferrer">Abrir ↗</a>}
                  {it.pode_editar && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditandoItem(true)}>Editar item</button>}
                  {it.pode_editar && <button type="button" className="btn btn-danger btn-sm" onClick={excluirItem}>Excluir item</button>}
                </div>
              </div>
            )}

            {equip ? (
              <>
                <div className="ac-g-bloco">
                  <div className="ac-g-rot">Usuários possíveis</div>
                  <div className="ac-chips">
                    {usuariosSoltos.map((c) => (editandoCred === c.id
                      ? <CredForm key={c.id} inicial={c} modo="usuario" onSalvar={(b) => salvarCred(b, c)} onCancelar={() => setEditandoCred(null)} />
                      : (
                        <span key={c.id} className="ac-chip-grupo" title={`Incluído por ${c.minha ? "você" : c.criado_por_nome || "—"}`}>
                          <button type="button" className="ac-chip" onClick={() => copiarTexto(c.usuario)}>{c.usuario} ⧉</button>
                          {c.pode_editar && <button type="button" className="ac-chip-x" aria-label={`Excluir ${c.usuario}`} onClick={() => excluirCred(c)}>✕</button>}
                        </span>
                      )))}
                    {!usuariosSoltos.length && <span className="ft-vazio">Nenhum (equipamento sem usuário ou ainda não informado).</span>}
                  </div>
                  {incluindo === "usuario"
                    ? <CredForm modo="usuario" onSalvar={(b) => salvarCred(b)} onCancelar={() => setIncluindo(null)} />
                    : <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setIncluindo("usuario")}>+ Usuário</button>}
                </div>
                <div className="ac-g-bloco">
                  <div className="ac-g-rot">Senhas para tentar <span className="ac-opc">na ordem</span></div>
                  {comSenha.map((c, k) => linhaSenha(c, k + 1))}
                  {!comSenha.length && <div className="ft-vazio">Nenhuma senha ainda.</div>}
                  {incluindo === "senha"
                    ? <div className="ac-linha"><CredForm equip modo="senha" onSalvar={(b) => salvarCred(b)} onCancelar={() => setIncluindo(null)} /></div>
                    : <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setIncluindo("senha")}>+ Adicionar senha</button>}
                </div>
              </>
            ) : (
              <div className="ac-g-bloco">
                <div className="ac-g-rot">Logins</div>
                {it.credenciais.map((c) => (c.tem_senha ? linhaSenha(c) : (editandoCred === c.id
                  ? <div key={c.id} className="ac-linha"><CredForm inicial={c} modo="login" onSalvar={(b) => salvarCred(b, c)} onCancelar={() => setEditandoCred(null)} /></div>
                  : (
                    <div key={c.id} className="ac-linha">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ac-cred"><button type="button" className="ac-chip" onClick={() => copiarTexto(c.usuario)}>{c.usuario} ⧉</button><span className="ft-vazio">sem senha cadastrada</span></div>
                        <div className="ac-autor">{c.rotulo && <b>{c.rotulo} · </b>}{c.minha ? "Você" : c.criado_por_nome || "—"}</div>
                      </div>
                      {acoes(c)}
                    </div>
                  ))))}
                {!it.credenciais.length && <div className="ft-vazio">Nenhum login cadastrado.</div>}
                {incluindo === "login"
                  ? <div className="ac-linha"><CredForm modo="login" onSalvar={(b) => salvarCred(b)} onCancelar={() => setIncluindo(null)} /></div>
                  : <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setIncluindo("login")}>+ Adicionar login</button>}
              </div>
            )}
            <div className="ft-vazio" style={{ padding: "12px 18px" }}>
              A senha mostrada some em 30 s. Mostrar e copiar ficam no log de auditoria.
              {it.criado_por_nome && <> Item incluído por {it.criado_por_nome} em {dataHora(it.criado_em)}.</>}
            </div>
          </>
        )}
      </aside>
      {editandoItem && it && (
        <ItemForm item={it} secoes={secoes} showToast={showToast} onFechar={() => setEditandoItem(false)}
          onSalvo={() => { setEditandoItem(false); carregar(); onMudou(); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ página

/** Acessos do setor: links, logins e senhas padrão de equipamentos.
 *  Todos incluem; cada um altera o que cadastrou; admin altera tudo. */
export default function Acessos() {
  const { toast, showToast } = useToast();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [soSenha, setSoSenha] = useState(false);
  const [aberto, setAberto] = useState(null);
  const [novoItem, setNovoItem] = useState(null); // { secao_id }
  const [verSecoes, setVerSecoes] = useState(false);

  const carregar = useCallback(() => {
    api.get("/ferramentas/acessos").then((d) => { setDados(d); setErro(""); }).catch((e) => setErro(e.message));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const secoes = useMemo(() => {
    if (!dados) return [];
    const termo = semAcento(busca.trim());
    return dados.secoes.map((s) => ({
      ...s,
      visiveis: s.itens.filter((i) => (!soSenha || i.senhas > 0)
        && (!termo || semAcento(`${s.nome} ${i.nome} ${i.descricao || ""} ${i.link || ""}`).includes(termo))),
    }));
  }, [dados, busca, soSenha]);
  const filtrando = busca.trim() || soSenha;

  return (
    <>
      <TopBar
        title="Ferramentas · Acessos do setor"
        subtitle="Links, logins e senhas padrão. Todos incluem; cada um altera o que cadastrou."
        right={(
          <div style={{ display: "flex", gap: 8 }}>
            {dados?.gerencia && <button className="btn btn-ghost" onClick={() => setVerSecoes(true)}>Seções</button>}
            <button className="btn btn-primary" disabled={!dados?.secoes.length} onClick={() => setNovoItem({})}>+ Novo item</button>
          </div>
        )}
      />
      <div className="content">
        <ErrorBox error={erro} />
        <div className="ft-filtros">
          <input type="search" placeholder="Buscar sistema, equipamento, cliente PABX…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <label className="chk"><input type="checkbox" checked={soSenha} onChange={(e) => setSoSenha(e.target.checked)} /> Só com senha</label>
        </div>
        {!dados ? <Spinner /> : !dados.secoes.length ? (
          <div className="card empty">Nenhuma seção ainda.{dados.gerencia ? " Use o botão \"Seções\" para criar a primeira." : " Peça a um administrador para criar as seções."}</div>
        ) : (
          <div className="ac-grade">
            {secoes.filter((s) => !filtrando || s.visiveis.length).map((s) => (
              <section key={s.id} className={`card ac-sec${s.tipo === "equipamentos" ? " eq" : ""}`}>
                <div className="ac-sec-topo">
                  <h2>{s.nome}</h2>
                  <button type="button" className="ac-sec-mais" title={`Incluir item em ${s.nome}`} onClick={() => setNovoItem({ secao_id: s.id })}>+</button>
                </div>
                {s.visiveis.map((i) => (
                  <div key={i.id} className={`ac-it${aberto === i.id ? " on" : ""}`}>
                    <div className="ac-it-linha">
                      {i.link
                        ? <a className="ac-link" href={href(i.link)} target="_blank" rel="noopener noreferrer" title={i.link}>{i.nome} <span aria-hidden="true">↗</span></a>
                        : <button type="button" className="ac-nome" onClick={() => setAberto(i.id)}>{i.nome}</button>}
                      <button type="button" className={`ac-key${i.linhas ? "" : " vazio"}`} onClick={() => setAberto(i.id)}
                        title={i.linhas ? "Ver usuários e senhas" : "Adicionar usuário/senha"}>🔑 {i.linhas || "+"}</button>
                    </div>
                    {i.descricao && <div className="ac-desc">{i.descricao}</div>}
                  </div>
                ))}
                {!s.visiveis.length && <div className="ft-vazio">Nenhum item.</div>}
              </section>
            ))}
            {filtrando && !secoes.some((s) => s.visiveis.length) && <div className="card empty">Nada encontrado.</div>}
          </div>
        )}
      </div>

      {aberto && (
        <Ficha itemId={aberto} secoes={dados?.secoes || []} showToast={showToast} confirm={confirm}
          onFechar={() => setAberto(null)} onMudou={carregar} />
      )}
      {novoItem && (
        <ItemForm secoes={dados.secoes} secaoPadrao={novoItem.secao_id} showToast={showToast}
          onFechar={() => setNovoItem(null)} onSalvo={(id) => { setNovoItem(null); carregar(); setAberto(id); }} />
      )}
      {verSecoes && <Secoes secoes={dados.secoes} onFechar={() => setVerSecoes(false)} onMudou={carregar} showToast={showToast} confirm={confirm} />}
      <Toast toast={toast} />
      <ConfirmModal state={confirmState} onResolve={resolveConfirm} />
    </>
  );
}
