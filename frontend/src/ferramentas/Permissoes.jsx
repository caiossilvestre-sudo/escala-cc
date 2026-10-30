import { useEffect, useState } from "react";
import { api } from "../api/client";
import { TopBar, Spinner, ErrorBox } from "../components/UI";

// Cabeçalho curto de cada coluna (o texto completo vem do backend, no title)
const CURTO = {
  "doc.ver": "Consultar / exportar", "doc.editar": "Cadastrar / importar foto", "doc.senhas": "Senhas", "doc.excluir": "Excluir",
  "doc.solicitar": "Solicitar (técnico)", "doc.tratar": "Tratar pedidos",
  "nvr.gerenciar": "Gravadores",
  "passagem.registrar": "Registrar / baixar", "passagem.gerenciar": "Gestor",
  "acessos.usar": "Usar", "acessos.gerenciar": "Editar todos",
  "escalation.infra": "Infraestrutura", "escalation.n2": "Operações (N2)",
  "ft.admin": "Permissões",
};
const IMPLICA = { "doc.editar": "doc.ver", "doc.senhas": "doc.ver", "doc.excluir": "doc.ver", "doc.solicitar": "doc.ver", "doc.tratar": "doc.ver", "passagem.gerenciar": "passagem.registrar", "acessos.gerenciar": "acessos.usar" };
// Colunas agrupadas no cabeçalho (prefixo do código -> título do grupo)
const GRUPOS = { doc: "Documentação", passagem: "Passagem de plantão", acessos: "Acessos do setor", escalation: "Escalation" };
const grupoDe = (codigo) => (GRUPOS[codigo.split(".")[0]] ? codigo.split(".")[0] : null);

/** Permissões de Ferramentas por página/tópico, por colaborador. */
export default function Permissoes({ onVoltar, showToast }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  const [salvando, setSalvando] = useState(null);

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
  // Na ordem do catálogo: grupos (Documentação, Passagem…) viram um título com
  // subcolunas; o resto fica numa coluna só.
  const blocos = [];
  cat.forEach((c) => {
    const g = grupoDe(c.codigo);
    const ult = blocos[blocos.length - 1];
    if (g && ult?.grupo === g) ult.cols.push(c);
    else blocos.push({ grupo: g, cols: [c] });
  });
  const colunas = blocos.flatMap((b) => b.cols);
  // Atalhos de Documentação trocam só as caixinhas "doc.*" — o resto (Passagem etc.) fica como está
  const aplicarAtalho = (p, preset) => salvar(p, [...p.permissoes.filter((c) => !c.startsWith("doc.")), ...preset]);
  const lista = dados.pessoas.filter((p) => !filtro || `${p.nome} ${p.equipe}`.toLowerCase().includes(filtro.toLowerCase()));

  const celula = (p, c) => (
    <td key={c.codigo} style={{ textAlign: "center" }}>
      <input
        type="checkbox"
        aria-label={`${c.label} — ${p.nome}`}
        title={c.label}
        checked={p.permissoes.includes(c.codigo)}
        disabled={p.fixo || salvando === p.colaborador_id}
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
        <div className="info-box">Cada caixinha salva na hora. Administradores do Escala têm tudo automaticamente. Os atalhos Leitura, N1, N2 e Técnico só preenchem as caixinhas da Documentação (Técnico consulta e envia pedidos para o N2; N2 inclui tratar esses pedidos); Plantonista libera a Passagem de plantão. Em Acessos do setor, "Usar" deixa a pessoa consultar links e senhas, incluir e alterar só o que ela cadastrou; "Editar todos" libera alterar qualquer item ou senha e organizar as seções — depois dá para ajustar uma a uma. Toda alteração fica no log de auditoria.</div>
        <div className="card">
          <div className="ft-filtros" style={{ marginBottom: 12 }}>
            <input type="search" placeholder="Filtrar por nome ou setor" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <div className="ft-tabela-wrap">
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th rowSpan={2}>Colaborador</th>
                  {blocos.map((b) => (b.grupo
                    ? <th key={b.grupo} colSpan={b.cols.length} style={{ textAlign: "center", borderBottom: "1px solid var(--border)" }}>{GRUPOS[b.grupo]}</th>
                    : <th key={b.cols[0].codigo} rowSpan={2} style={{ textAlign: "center" }} title={b.cols[0].label}>{CURTO[b.cols[0].codigo] || b.cols[0].label}</th>))}
                  <th rowSpan={2}>Atalhos</th>
                </tr>
                <tr>{blocos.filter((b) => b.grupo).flatMap((b) => b.cols).map((c) => <th key={c.codigo} style={{ textAlign: "center" }} title={c.label}>{CURTO[c.codigo] || c.label}</th>)}</tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.colaborador_id}>
                    <td><div style={{ fontWeight: 600 }}>{p.nome}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.fixo ? "Admin do Escala" : p.equipe}</div></td>
                    {colunas.map((c) => celula(p, c))}
                    <td>
                      {!p.fixo && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => aplicarAtalho(p, dados.presets.leitura)} title="Só consultar/exportar a Documentação — sem editar nada">Leitura</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => aplicarAtalho(p, dados.presets.n1)}>N1</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => aplicarAtalho(p, dados.presets.n2)} title="Documentação completa + tratar as solicitações dos técnicos">N2</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => aplicarAtalho(p, dados.presets.tecnico)} title="Consultar e pedir alterações/fotos ao N2 — não edita nada">Técnico</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => salvar(p, [...new Set([...p.permissoes, ...(dados.presets.plantonista || [])])])} title="Libera registrar a passagem de plantão (mantém o resto)">Plantonista</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => salvar(p, [])} title="Remover todo o acesso">Nenhum</button>
                        </div>
                      )}
                    </td>
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
