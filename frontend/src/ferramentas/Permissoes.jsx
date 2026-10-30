import { useEffect, useState } from "react";
import { api } from "../api/client";
import { TopBar, Spinner, ErrorBox } from "../components/UI";

// Cabeçalho curto de cada coluna (o texto completo vem do backend, no title)
const CURTO = {
  "doc.ver": "Consultar", "doc.editar": "Cadastrar / foto", "doc.senhas": "Ver senhas", "doc.excluir": "Excluir",
  "doc.solicitar": "Solicitar (técnico)", "doc.tratar": "Tratar pedidos",
  "nvr.gerenciar": "Gravadores",
  "passagem.registrar": "Registrar", "passagem.gerenciar": "Gestor",
  "acessos.usar": "Usar", "acessos.gerenciar": "Editar tudo",
  "escalation.infra": "Infraestrutura", "escalation.n2": "Operações (N2)",
  "ft.admin": "Permissões",
};
const IMPLICA = { "doc.editar": "doc.ver", "doc.senhas": "doc.ver", "doc.excluir": "doc.ver", "doc.solicitar": "doc.ver", "doc.tratar": "doc.ver", "passagem.gerenciar": "passagem.registrar", "acessos.gerenciar": "acessos.usar" };
// Colunas agrupadas no cabeçalho (prefixo do código -> grupo). Toda coluna tem
// grupo; cada grupo ganha faixa de cor própria e linha separadora.
const GRUPOS = { doc: "LifeGuard · Documentação", nvr: "LifeGuard · Documentação", passagem: "Passagem de plantão", acessos: "Acessos do setor", escalation: "Escalation", ft: "Administração" };
const CHAVE = { nvr: "doc" }; // Gravadores entra no mesmo grupo da Documentação
const grupoDe = (codigo) => { const pre = codigo.split(".")[0]; return GRUPOS[pre] ? (CHAVE[pre] || pre) : "outros"; };

/** Permissões de Ferramentas por página/tópico, por colaborador. */
export default function Permissoes({ onVoltar, showToast }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  const [salvando, setSalvando] = useState(null);
  const [lote, setLote] = useState(null); // código da coluna sendo aplicada para todos

  const carregar = () => api.get("/ferramentas/permissoes").then(setDados).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  const salvar = async (pessoa, lista) => {
    setSalvando(pessoa.colaborador_id);
    try {
      const r = await api.post("/ferramentas/permissoes", { colaborador_id: pessoa.colaborador_id, permissoes: lista });
      setDados((d) => ({ ...d, pessoas: d.pessoas.map((p) => (p.colaborador_id === pessoa.colaborador_id ? { ...p, permissoes: r.permissoes } : p)) }));
    } catch (e) { showToast(e.message); } finally { setSalvando(null); }
  };

  const alternar = (pessoa, codigo) => {
    const atual = new Set(pessoa.permissoes);
    if (atual.has(codigo)) {
      atual.delete(codigo);
      // tirar "consultar" tira junto o que depende dele
      Object.entries(IMPLICA).forEach(([k, base]) => { if (base === codigo) atual.delete(k); });
    } else {
      atual.add(codigo);
    }
    salvar(pessoa, [...atual]);
  };

  if (!dados) return (<><TopBar title="Ferramentas · Permissões" /><div className="content"><ErrorBox error={erro} />{!erro && <Spinner />}</div></>);

  const cat = dados.catalogo;
  // Na ordem do catálogo: cada grupo vira um título com subcolunas, numa
  // faixa de cor alternada e com linha separadora à esquerda.
  const blocos = [];
  cat.forEach((c) => {
    const g = grupoDe(c.codigo);
    const ult = blocos[blocos.length - 1];
    if (ult?.grupo === g) ult.cols.push(c);
    else blocos.push({ grupo: g, cols: [c] });
  });
  const colunas = blocos.flatMap((b, bi) => b.cols.map((c, ci) => ({ ...c, cls: `${bi % 2 ? "g-b" : "g-a"}${ci === 0 ? " g-ini" : ""}` })));
  const lista = dados.pessoas.filter((p) => !filtro || `${p.nome} ${p.equipe}`.toLowerCase().includes(filtro.toLowerCase()));

  // Marca (ou desmarca, se todos já têm) uma coluna para todo mundo que está no filtro
  const marcarColuna = async (c) => {
    const alvo = lista.filter((p) => !p.fixo);
    if (!alvo.length) return;
    const todosTem = alvo.every((p) => p.permissoes.includes(c.codigo));
    const rotulo = `"${CURTO[c.codigo] || c.label}"${GRUPOS[grupoDe(c.codigo)] ? ` (${GRUPOS[grupoDe(c.codigo)]})` : ""}`;
    const quem = filtro ? `as ${alvo.length} pessoas do filtro "${filtro}"` : `TODAS as ${alvo.length} pessoas`;
    if (!window.confirm(`${todosTem ? "Tirar" : "Dar"} ${rotulo} para ${quem}?`)) return;
    setLote(c.codigo);
    try {
      for (const p of alvo) {
        const atual = new Set(p.permissoes);
        if (todosTem) {
          atual.delete(c.codigo);
          Object.entries(IMPLICA).forEach(([k, base]) => { if (base === c.codigo) atual.delete(k); });
        } else {
          if (atual.has(c.codigo)) continue;
          atual.add(c.codigo);
        }
        await salvar(p, [...atual]);
      }
      showToast(`${todosTem ? "Removido de" : "Liberado para"} ${alvo.length} pessoa(s).`);
    } finally { setLote(null); }
  };
  const tituloColuna = (c) => (
    <>
      <div>{CURTO[c.codigo] || c.label}</div>
      <button type="button" className="ft-perm-todos" disabled={!!lote || !lista.some((p) => !p.fixo)}
        title={`Marcar/desmarcar para todos ${filtro ? "do filtro" : "da lista"}`} onClick={() => marcarColuna(c)}>
        {lote === c.codigo ? "…" : "todos"}
      </button>
    </>
  );

  const celula = (p, c) => (
    <td key={c.codigo} className={c.cls} style={{ textAlign: "center" }}>
      <input
        type="checkbox"
        aria-label={`${c.label} — ${p.nome}`}
        title={`${GRUPOS[grupoDe(c.codigo)] || ""} · ${CURTO[c.codigo] || c.label} — ${p.nome}`}
        checked={p.permissoes.includes(c.codigo)}
        disabled={p.fixo || salvando === p.colaborador_id || !!lote}
        onChange={() => alternar(p, c.codigo)}
        style={{ width: 16, height: 16, cursor: p.fixo ? "default" : "pointer", accentColor: "var(--primary)" }}
      />
    </td>
  );

  return (
    <>
      <TopBar title="Ferramentas · Permissões" subtitle="Acesso por página/tópico das Ferramentas — independe do perfil na escala" right={<button className="btn btn-ghost" onClick={onVoltar}>← Voltar</button>} />
      <div className="content">
        <ErrorBox error={erro} />
        <details className="info-box ft-perm-legenda">
          <summary>O que cada coluna libera <span>(clique para ver)</span></summary>
          <dl>
            <dt>LifeGuard · Documentação</dt>
            <dd><b>Consultar</b> ver e exportar câmeras · <b>Cadastrar / foto</b> incluir, editar, importar fotos · <b>Ver senhas</b> senhas dos gravadores · <b>Excluir</b> câmeras LifeGuard · <b>Solicitar</b> técnico pede alteração ao N2 · <b>Tratar pedidos</b> N2 resolve esses pedidos · <b>Gravadores</b> incluir/editar/desativar NVRs</dd>
            <dt>Passagem de plantão</dt>
            <dd><b>Registrar</b> registrar a passagem, dar ciência e baixar pendências · <b>Gestor</b> painel do gestor, editar e excluir qualquer registro</dd>
            <dt>Acessos do setor</dt>
            <dd><b>Usar</b> ver links e senhas, incluir e alterar o que a própria pessoa cadastrou · <b>Editar tudo</b> alterar qualquer item/senha e organizar as seções</dd>
            <dt>Escalation</dt>
            <dd><b>Infraestrutura</b> link externo de escalation · <b>Operações (N2)</b> página do N2 (em construção)</dd>
            <dt>Administração</dt>
            <dd><b>Permissões</b> abrir esta tela e liberar acessos</dd>
          </dl>
          <p>Cada caixinha salva na hora. O <b>todos</b> embaixo de cada coluna marca (ou desmarca) para quem está no filtro. Admin do Escala tem tudo automaticamente. Toda alteração fica no log de auditoria.</p>
        </details>
        <div className="card">
          <div className="ft-filtros" style={{ marginBottom: 12 }}>
            <input type="search" placeholder="Filtrar por nome ou setor" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <div className="ft-tabela-wrap ft-perm-wrap">
            <table className="tbl ft-perm" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th rowSpan={2} className="ft-perm-fixa">Colaborador{lista.length !== dados.pessoas.length && <div className="ft-perm-qtd">{lista.length} de {dados.pessoas.length}</div>}</th>
                  {blocos.map((b, bi) => (
                    <th key={b.grupo} colSpan={b.cols.length} className={`ft-perm-grupo ${bi % 2 ? "g-b" : "g-a"} g-ini`}>{GRUPOS[b.grupo] || "Outros"}</th>
                  ))}
                </tr>
                <tr>{colunas.map((c) => <th key={c.codigo} className={`ft-perm-col ${c.cls}`} title={c.label}>{tituloColuna(c)}</th>)}</tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.colaborador_id}>
                    <td className="ft-perm-fixa"><div style={{ fontWeight: 600 }}>{p.nome}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.fixo ? "Admin do Escala" : p.equipe}</div></td>
                    {colunas.map((c) => celula(p, c))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
